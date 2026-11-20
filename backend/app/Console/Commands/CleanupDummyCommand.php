<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Removes the sample data identified in docs/audit/dummy-data-cleanup.md (approved 2026-11-20): the items
 * ELK.9001 … GAS.9008, the documents numbered …/26/XI/901–908 that `stockwise:sample-data` made, the
 * PO made from one of them, its inactive Update Alerts and the vendors marked source = 'demo'.
 *
 * Safe by construction: it starts from these explicit seeds, follows every foreign key to collect what
 * hangs on them, and REFUSES when anything outside the set would change: a document of another number, a
 * real row that would lose a link (SET NULL), a ledger row of a real item pointing at a sample document.
 * It deletes by id, children first, in one transaction. Without --execute it only reports (dry run).
 */
class CleanupDummyCommand extends Command
{
    protected $signature = 'stockwise:cleanup-dummy {--execute : Delete for real (default: dry run)}';

    protected $description = 'Delete the identified sample/demo data (dry run unless --execute)';

    private const SAMPLE_ITEMS = ['ELK.9001', 'MKN.9002', 'OLI.9003', 'SPR.9004', 'ATK.9005', 'SPR.9006', 'APD.9007', 'GAS.9008'];

    /** header tables: a row here may only go when it is a seed, never because something hangs on it */
    private const GUARDED = ['items', 'vendors', 'users', 'item_requests', 'npbg', 'ppb', 'ri', 'purchase_orders', 'stock_opnames', 'price_list_drafts',
        'purchase_returns', 'important_requests', 'ppb_drafts', 'update_alerts', 'categories', 'units', 'warehouses', 'sites'];

    /** @var array<string, array<int, true>> table => ids */
    private array $set = [];

    /** @var array<string, list<array{table:string, column:string, rule:string}>> referenced table => its children */
    private array $children = [];

    /** @var list<string> */
    private array $blockers = [];

    public function handle(): int
    {
        $this->loadForeignKeys();
        $this->seed();
        $this->expand();
        $this->checkMorphs();
        $this->report();

        if ($this->blockers) {
            $this->error('Refused: something outside the sample set would change.');
            foreach ($this->blockers as $b) {
                $this->line('  - '.$b);
            }

            return self::FAILURE;
        }
        if (! $this->option('execute')) {
            $this->info('Dry run: nothing deleted. Run again with --execute to delete exactly the rows above.');

            return self::SUCCESS;
        }

        DB::transaction(function () {
            foreach ($this->deleteOrder() as $table) {
                $ids = array_keys($this->set[$table]);
                foreach (array_chunk($ids, 500) as $chunk) {
                    $n = DB::table($table)->whereIn('id', $chunk)->delete();
                    if ($n !== count($chunk)) {
                        throw new \RuntimeException("{$table}: expected to delete ".count($chunk)." rows, deleted {$n}. Rolled back.");
                    }
                }
            }
        });
        $this->info('Deleted.');

        return self::SUCCESS;
    }

    private function seed(): void
    {
        $sampleNo = fn (string $table, string $col, string $prefix) => DB::table($table)->where($col, 'like', $prefix.'9__')->pluck('id');
        $this->add('items', DB::table('items')->whereIn('code', self::SAMPLE_ITEMS)->whereNull('source')->pluck('id'));
        $this->add('item_requests', $sampleNo('item_requests', 'number', 'REQ/26/XI/'));
        $this->add('npbg', $sampleNo('npbg', 'no_npbg', 'NPBG/MANUAL/26/XI/'));
        $this->add('ppb', $sampleNo('ppb', 'no_ppb', 'PPB/NA/26/XI/'));
        $this->add('ri', $sampleNo('ri', 'no_ri', 'RI/MANUAL/26/XI/'));
        $this->add('purchase_orders', $sampleNo('purchase_orders', 'number', 'PO/PPB/26/XI/'));
        $this->add('stock_opnames', $sampleNo('stock_opnames', 'number', 'SO/26/XI/'));
        $this->add('price_list_drafts', $sampleNo('price_list_drafts', 'number', 'PL/26/XI/'));
        $this->add('purchase_returns', $sampleNo('purchase_returns', 'number', 'RTR/26/XI/'));
        $this->add('important_requests', $sampleNo('important_requests', 'number', 'IMP/26/XI/'));
        $this->add('ppb_drafts', $sampleNo('ppb_drafts', 'number', 'RST/26/XI/'));
        // made from sample PPB/NA/26/XI/907 (approved_ppb_id), the only other document holding a sample item
        $this->add('purchase_orders', DB::table('purchase_orders')->where('number', 'PO/PPB/26/XI/001')->whereIn('id',
            DB::table('purchase_order_items')->whereIn('approved_ppb_id', array_keys($this->set['ppb'] ?? []))->pluck('purchase_order_id'))->pluck('id'));
        $this->add('update_alerts', DB::table('update_alerts')->where('is_active', false)->whereDate('created_at', '2026-11-18')->pluck('id'));
        $this->add('vendors', DB::table('vendors')->where('source', 'demo')->pluck('id'));
        // the per-item rows of sample items that point at them by code (no foreign key)
        foreach (['npbg', 'ppb', 'ri', 'purchase_return_lines'] as $t) {
            $rows = DB::table($t)->whereIn('kode_barang', self::SAMPLE_ITEMS)->pluck('id');
            if ($t === 'purchase_return_lines') {
                $this->add($t, $rows);
            } else {
                $outside = $rows->diff(array_keys($this->set[$t] ?? []));
                foreach ($outside as $id) {
                    $this->blockers[] = "{$t} #{$id} uses a sample item but is not a sample document";
                }
            }
        }
        $this->seeds = array_map(fn ($ids) => $ids, $this->set);
    }

    /** @var array<string, array<int, true>> */
    private array $seeds = [];

    /** Follow every foreign key into the set until nothing new comes in. */
    private function expand(): void
    {
        $queue = array_keys($this->set);
        $checked = [];
        while ($queue) {
            $parent = array_shift($queue);
            foreach ($this->children[$parent] ?? [] as $fk) {
                $key = "{$fk['table']}.{$fk['column']}<-{$parent}:".count($this->set[$parent]);
                if (isset($checked[$key])) {
                    continue;
                }
                $checked[$key] = true;
                $parentIds = array_keys($this->set[$parent]);
                $rows = collect();
                foreach (array_chunk($parentIds, 1000) as $chunk) {
                    $rows = $rows->merge(DB::table($fk['table'])->whereIn($fk['column'], $chunk)->pluck('id'));
                }
                $new = $rows->reject(fn ($id) => isset($this->set[$fk['table']][$id]));
                if ($new->isEmpty()) {
                    continue;
                }
                if ($fk['rule'] === 'SET NULL') {
                    // a row outside the set would only lose its link: fine when that row goes too, else it is real data changing
                    $this->pendingSetNull[$fk['table']][$fk['column']] = array_merge($this->pendingSetNull[$fk['table']][$fk['column']] ?? [], $new->all());

                    continue;
                }
                if (in_array($fk['table'], self::GUARDED, true)) {
                    foreach ($new as $id) {
                        $this->blockers[] = "{$fk['table']} #{$id} hangs on {$parent} (via {$fk['column']}, {$fk['rule']}) but is not in the sample set";
                    }

                    continue;
                }
                $this->add($fk['table'], $new);
                $queue[] = $fk['table'];
            }
        }
        // SET NULL links from rows that do not go
        foreach ($this->pendingSetNull as $table => $cols) {
            foreach ($cols as $col => $ids) {
                $left = array_values(array_filter(array_unique($ids), fn ($id) => ! isset($this->set[$table][$id])));
                if ($left) {
                    $this->blockers[] = "{$table}.{$col}: ".count($left).' row(s) outside the set would lose their link (ids '.implode(',', array_slice($left, 0, 10)).')';
                }
            }
        }
    }

    /** @var array<string, array<string, list<int>>> */
    private array $pendingSetNull = [];

    /** Rows that point at a sample row by *_type / *_id (ledger, notes, notifications): they go with it, unless they belong to a real item. */
    private function checkMorphs(): void
    {
        $classTable = [];
        foreach (DB::select('SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME LIKE "%\_type"') as $col) {
            $base = substr($col->c, 0, -5);
            if (str_starts_with($col->t, 'accurate_') || ! Schema::hasColumn($col->t, $base.'_id') || ! Schema::hasColumn($col->t, 'id')) {
                continue;
            }
            foreach (DB::table($col->t)->whereNotNull($col->c)->distinct()->pluck($col->c) as $type) {
                $table = $classTable[$type] ??= (class_exists($type) && is_subclass_of($type, Model::class) ? (new $type)->getTable() : null);
                if (! $table || empty($this->set[$table])) {
                    continue;
                }
                $rows = DB::table($col->t)->where($col->c, $type)->whereIn($base.'_id', array_keys($this->set[$table]))->get();
                foreach ($rows as $row) {
                    if (isset($this->set[$col->t][$row->id ?? 0])) {
                        continue;
                    }
                    if (property_exists($row, 'item_id') && $row->item_id && ! isset($this->set['items'][$row->item_id])) {
                        $this->blockers[] = "{$col->t} #{$row->id} of a real item (#{$row->item_id}) points at sample {$table} #{$row->{$base.'_id'}}";

                        continue;
                    }
                    if (isset($row->id)) {
                        $this->add($col->t, [$row->id]);
                    }
                }
            }
        }
    }

    private function report(): void
    {
        $rows = [];
        foreach ($this->set as $table => $ids) {
            $rows[] = [$table, count($ids), isset($this->seeds[$table]) ? count($this->seeds[$table]) : 0, implode(',', array_slice(array_keys($ids), 0, 8)).(count($ids) > 8 ? ',…' : '')];
        }
        usort($rows, fn ($a, $b) => strcmp($a[0], $b[0]));
        $this->table(['table', 'rows', 'of which seeds', 'ids'], $rows);
        $this->line('Total rows: '.array_sum(array_map('count', $this->set)));
    }

    /** Children before parents (by the foreign keys among the tables in the set). */
    private function deleteOrder(): array
    {
        $tables = array_keys($this->set);
        $dependsOn = []; // child => parents it references
        foreach ($this->children as $parent => $fks) {
            foreach ($fks as $fk) {
                if ($fk['table'] !== $parent && in_array($fk['table'], $tables, true) && in_array($parent, $tables, true)) {
                    $dependsOn[$parent][] = $fk['table']; // parent must wait for this child
                }
            }
        }
        $order = [];
        $visit = function (string $t, array $path = []) use (&$visit, &$order, $dependsOn) {
            if (in_array($t, $order, true) || in_array($t, $path, true)) {
                return;
            }
            foreach ($dependsOn[$t] ?? [] as $child) {
                $visit($child, [...$path, $t]);
            }
            $order[] = $t;
        };
        foreach ($tables as $t) {
            $visit($t);
        }

        return $order;
    }

    private function loadForeignKeys(): void
    {
        $sql = 'SELECT k.TABLE_NAME t, k.COLUMN_NAME c, k.REFERENCED_TABLE_NAME rt, rc.DELETE_RULE d FROM information_schema.KEY_COLUMN_USAGE k
                JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
                WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL';
        foreach (DB::select($sql) as $r) {
            if (! Schema::hasColumn($r->t, 'id')) {
                // a pivot without its own id: deleted through its parent's cascade, nothing real hangs on it
                $this->pivots[$r->rt][] = ['table' => $r->t, 'column' => $r->c];

                continue;
            }
            $this->children[$r->rt][] = ['table' => $r->t, 'column' => $r->c, 'rule' => $r->d];
        }
    }

    /** @var array<string, list<array{table:string, column:string}>> */
    private array $pivots = [];

    private function add(string $table, iterable $ids): void
    {
        foreach ($ids as $id) {
            $this->set[$table][(int) $id] = true;
        }
    }
}
