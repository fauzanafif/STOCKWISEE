<?php

namespace App\Services\Search;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Smart Search of the Master Barang: finds items by what the user means, not by the exact way Accurate wrote the
 * name. Nothing is written to the items: a search index is built from them (in the cache, rebuilt by itself when
 * an item changes — e.g. after the Accurate sync) and the original code / name are always what is shown.
 *
 *   normalised  upper case, Ø / no-break space folded, punctuation → space, decimals kept ("2.5"), units joined
 *               ("2.5 MM" → "2.5MM", 1" / 1 INCH → "1IN")
 *   size        tyre sizes read as width + rim whatever the writing: 7.50-16, 7.50 R16, 7.50-R16, 750-16, 750/16,
 *               750 R16 → SZ750-16; 225/60-R18 → SZ225/60-18. Only in those patterns is "7.50" read as "750".
 *   words       every word must match: exactly, through a validated synonym, as the start of a word, or with a typo
 *               (1 letter for 4–7 letters, 2 for longer); a size in the search must be the item's size
 *   ranking     exact code > code start > exact name > same size > all words exact > word starts > typo
 *   brand       the "NAME - BRAND / …" segment, only when it has no digits / sizes and at least 2 items share it
 */
final class ItemSmartSearch
{
    /** validated against the data (TYRE / TIRE are written BAN; KOTAK and BOX are both used) */
    public const SYNONYMS = ['TYRE' => ['BAN'], 'TIRE' => ['BAN'], 'KOTAK' => ['BOX'], 'BOX' => ['KOTAK']];

    private const TYRE_WORDS = ['BAN', 'TYRE', 'TIRE', 'VULKANISIR', 'VELG', 'RIM'];

    public const LABELS = ['CODE' => 'Exact code', 'CODE_START' => 'Code', 'NAME' => 'Exact name', 'SIZE' => 'Same size',
        'WORDS' => 'All words', 'START' => 'Word start', 'SIMILAR' => 'Similar', 'PARTIAL' => 'Partly matching'];

    private ?array $index = null;

    // ------------------------------------------------------------------ text

    public static function normalize(string $text): string
    {
        $s = mb_strtoupper(strtr($text, ['Ø' => 'O', 'ø' => 'o', '⌀' => 'O', "\u{00A0}" => ' ']));
        $s = preg_replace('/(\d+(?:[.,]\d+)?)\s*(?:"|\'\'|INCHI?|INCH)(?![A-Z])/u', '$1IN ', $s);
        $s = preg_replace('/(\d),(\d)/', '$1.$2', $s);
        $s = preg_replace('/(?<!\d)\.|\.(?!\d)/', ' ', $s);              // a dot only stays between digits
        $s = preg_replace('/[^A-Z0-9.]+/u', ' ', $s);
        $s = preg_replace('/\b(\d+(?:\.\d+)?)\s+(MM|CM|MTR|M|KG|GR|G|ML|L|V|W|A|MM2|INCH)\b/', '$1$2', $s);

        return trim(preg_replace('/\s+/', ' ', $s));
    }

    /**
     * Tyre sizes in a text, as canonical keys (the "R" of a radial is kept apart as a hint, it never filters).
     *
     * @return array{0: list<string>, 1: string} [size keys, the text without them]
     */
    public static function sizes(string $text): array
    {
        $up = mb_strtoupper(strtr($text, ["\u{00A0}" => ' ']));
        $keys = [];
        // inner tubes: (7.50)-16, (7.50/8.25)-16, (10.00/11.00)-20 — each width in the brackets fits that rim
        $up = preg_replace_callback('/\(\s*(\d{1,2}[.,]\d{2}(?:\s*\/\s*\d{1,2}[.,]\d{2})*)\s*\)\s*-?\s*R?\s*(\d{2}(?:\.\d)?)(?!\d)/', function ($m) use (&$keys) {
            foreach (preg_split('/\s*\/\s*/', $m[1]) as $w) {
                [$a, $b] = preg_split('/[.,]/', $w);
                $keys[] = 'SZ'.((int) $a).$b.'-'.$m[2];
            }

            return ' ';
        }, $up);
        // metric: 225/60-R18, 225/60 R18, 225/60R18
        $up = preg_replace_callback('/\b(\d{3})\s*\/\s*(\d{2})\s*-?\s*R?\s*(\d{2}(?:\.\d)?)\b/', function ($m) use (&$keys) {
            $keys[] = "SZ{$m[1]}/{$m[2]}-{$m[3]}";

            return ' ';
        }, $up);
        // decimal width: 7.50-16, 7.50 R16, 7.50-R16, 10.00/20, 7.50R16
        $up = preg_replace_callback('/\b(\d{1,2})[.,](\d{2})\s*(?:[-\/]\s*R?|R|\s+R?)\s*(\d{2}(?:\.\d)?)\b/', function ($m) use (&$keys) {
            $keys[] = 'SZ'.((int) $m[1]).$m[2].'-'.$m[3];

            return ' ';
        }, $up);
        // whole width (750-16, 750/16, 750 R16, 185-R14): only with a tyre word, so a bolt "1100-20" stays a bolt
        if (preg_match('/\b('.implode('|', self::TYRE_WORDS).')\b/', $up)) {
            $up = preg_replace_callback('/\b(\d{3,4})\s*(?:[-\/]\s*R?|\s+R)\s*(\d{2}(?:\.\d)?)\b/', function ($m) use (&$keys) {
                $keys[] = "SZ{$m[1]}-{$m[2]}";

                return ' ';
            }, $up);
        }

        return [array_values(array_unique($keys)), $up];
    }

    /** @return list<string> */
    public static function tokens(string $text): array
    {
        $n = self::normalize($text);

        return $n === '' ? [] : array_values(array_unique(explode(' ', $n)));
    }

    // ------------------------------------------------------------------ index

    /** The index of all items, from the cache; rebuilt when an item is added / changed / removed. */
    public function index(): array
    {
        if ($this->index !== null) {
            return $this->index;
        }
        $stamp = DB::table('items')->selectRaw('COUNT(*) c, MAX(updated_at) u, MAX(id) i')->first();
        $key = 'item-smart-search:v1:'.md5(($stamp->c ?? 0).'|'.($stamp->u ?? '').'|'.($stamp->i ?? 0));

        return $this->index = Cache::remember($key, now()->addDays(2), fn () => $this->build());
    }

    private function build(): array
    {
        $items = [];
        $inverted = [];
        $brandCount = [];
        $rows = DB::table('items')->orderBy('id')->get(['id', 'code', 'description']);
        foreach ($rows as $r) {
            $desc = (string) $r->description;
            [$sizes] = self::sizes($desc);
            // the words as written (so "7.50" alone still finds 7.50-16), plus each size's width both ways: 7.50 / 750
            $tokens = self::tokens($desc);
            foreach ($sizes as $sz) {
                if (preg_match('/^SZ(\d{1,2})(\d{2})-/', $sz, $w)) {
                    $tokens[] = $w[1].$w[2];
                    $tokens[] = $w[1].'.'.$w[2];
                }
            }
            $tokens = array_values(array_unique($tokens));
            $brand = self::brandCandidate($desc);
            if ($brand !== null) {
                $brandCount[$brand] = ($brandCount[$brand] ?? 0) + 1;
            }
            $items[(int) $r->id] = ['c' => mb_strtoupper((string) $r->code), 'n' => self::normalize($desc), 's' => $sizes, 'b' => $brand];
            foreach (array_merge($tokens, $sizes) as $t) {
                $inverted[$t][] = (int) $r->id;
            }
        }
        foreach ($items as $id => $it) {
            if ($it['b'] !== null && ($brandCount[$it['b']] ?? 0) < 2) {
                $items[$id]['b'] = null; // one item alone does not make a brand
            }
        }

        return ['items' => $items, 'inv' => $inverted];
    }

    /** "NAME - BRAND / spec / …" → BRAND, only when it reads like a name (no digits, sizes, quotes). */
    private static function brandCandidate(string $desc): ?string
    {
        $parts = explode(' - ', $desc, 2);
        if (count($parts) < 2) {
            return null;
        }
        $seg = trim(explode(' / ', $parts[1], 2)[0]);
        if ($seg === '' || mb_strlen($seg) > 30 || preg_match('/[0-9"\'=@\/]/', $seg) || ! preg_match('/[A-Za-z]{2}/', $seg)) {
            return null;
        }

        return mb_strtoupper(preg_replace('/\s+/', ' ', $seg));
    }

    // ------------------------------------------------------------------ search

    /**
     * Matching items, best first.
     *
     * @return array<int, array{score:int, label:string, brand:?string}> item id => match
     */
    public function search(string $query): array
    {
        $query = trim($query);
        if ($query === '') {
            return [];
        }
        $idx = $this->index();
        $items = $idx['items'];
        $inv = $idx['inv'];
        [$qSizes, $rest] = self::sizes($query);
        $qTokens = self::tokens($rest);
        $qNorm = self::normalize($query);
        $qCode = mb_strtoupper(preg_replace('/\s+/', '', $query));
        $out = [];

        // the code first: exact, then its start
        foreach ($items as $id => $it) {
            if ($it['c'] === $qCode) {
                $out[$id] = ['score' => 1000, 'label' => 'CODE', 'brand' => $it['b']];
            } elseif (mb_strlen($qCode) >= 3 && str_starts_with($it['c'], $qCode)) {
                $out[$id] = ['score' => 600, 'label' => 'CODE_START', 'brand' => $it['b']];
            } elseif (mb_strlen($qCode) >= 4 && ! str_contains($query, ' ') && str_contains($it['c'], $qCode)) {
                $out[$id] = ['score' => 450, 'label' => 'CODE_START', 'brand' => $it['b']];
            }
        }

        // every word (and size) of the search → the items having it, with how well
        $perTerm = [];
        $required = []; // a number / spec / size is never dropped, not even for "partly matching"
        foreach ($qTokens as $t) {
            $required[count($perTerm)] = (bool) preg_match('/\d/', $t);
            $perTerm[] = $this->matchesFor($t, $inv);
        }
        foreach ($qSizes as $s) {
            $required[count($perTerm)] = true;
            $perTerm[] = array_fill_keys($inv[$s] ?? [], 100);
        }
        if ($perTerm === []) {
            return $this->sorted($out);
        }
        $found = $this->combine($perTerm, count($perTerm), $required);
        $partial = false;
        if ($found === [] && count($perTerm) >= 2 && $out === [] && in_array(false, $required, true)) {
            // nothing has every word: those missing one plain word, clearly labelled
            $found = $this->combine($perTerm, count($perTerm) - 1, $required);
            $partial = true;
        }
        foreach ($found as $id => [$sum, $min]) {
            if (isset($out[$id])) {
                continue;
            }
            $it = $items[$id];
            $label = $partial ? 'PARTIAL' : match (true) {
                $it['n'] === $qNorm => 'NAME',
                $qSizes !== [] => 'SIZE',
                $min >= 30 => 'WORDS',
                $min >= 20 => 'START',
                default => 'SIMILAR',
            };
            $score = match ($label) { 'NAME' => 800, 'SIZE' => 400, 'WORDS' => 300, 'START' => 200, 'SIMILAR' => 100, default => 50 } + min($sum, 99);
            $out[$id] = ['score' => $score, 'label' => $label, 'brand' => $it['b']];
        }

        return $this->sorted($out);
    }

    public function brandOf(int $id): ?string
    {
        return $this->index()['items'][$id]['b'] ?? null;
    }

    /** @return list<int> */
    public function idsOfBrand(string $brand): array
    {
        $brand = mb_strtoupper(trim($brand));

        return array_keys(array_filter($this->index()['items'], fn ($it) => $it['b'] === $brand));
    }

    /**
     * The matches grouped by brand: per brand the number of item types, how many have stock, and the total stock —
     * the QTY of the Master Barang (all warehouses, Accurate's qty while an item has no stock row, never below 0),
     * summed per unit (PCS and SET are never added together). Items whose brand is not clear stay in one last group.
     * $excludeUsed leaves out the items written "(BEKAS)" (used — often still usable, so a choice of its own),
     * $excludeDamaged those written "(RUSAK)" (damaged).
     */
    public function brandSummary(string $query, bool $activeOnly = true, bool $excludeUsed = false, bool $excludeDamaged = false, int $limit = 1000): array
    {
        $matches = $this->search($query);
        $ids = array_slice(array_keys($matches), 0, $limit);
        $items = \App\Models\Item::with('unit:id,code')->whereIn('id', $ids)
            ->when($activeOnly, fn ($q) => $q->where('is_active', true))
            ->get(['id', 'code', 'description', 'unit_id', 'accurate_qty_onhand', 'is_active'])->keyBy('id');
        $stock = \App\Models\Inventory::whereIn('item_id', $items->keys())->groupBy('item_id')->selectRaw('item_id, SUM(actual_qty) q')->pluck('q', 'item_id');

        $groups = [];
        foreach ($ids as $id) {
            $item = $items->get($id);
            if (! $item) {
                continue;
            }
            $cond = self::condition((string) $item->description);
            if (($excludeUsed && $cond === 'BEKAS') || ($excludeDamaged && $cond === 'RUSAK')) {
                continue;
            }
            $qty = round(max(0.0, (float) ($stock[$id] ?? $item->accurate_qty_onhand ?? 0)), 2);
            $unit = $item->unit?->code ?? '-';
            $brand = $matches[$id]['brand'];
            $key = $brand ?? '';
            $groups[$key] ??= ['brand' => $brand, 'items_count' => 0, 'in_stock_count' => 0, 'totals' => [], 'items' => []];
            $groups[$key]['items_count']++;
            $groups[$key]['in_stock_count'] += $qty > 0 ? 1 : 0;
            $groups[$key]['totals'][$unit] = round(($groups[$key]['totals'][$unit] ?? 0) + $qty, 2);
            $groups[$key]['items'][] = ['id' => $item->id, 'code' => $item->code, 'description' => $item->description, 'unit' => $unit, 'qty' => $qty,
                'condition' => $cond, 'relevance' => self::LABELS[$matches[$id]['label']] ?? null];
        }
        $rows = collect($groups)->map(function ($g) {
            $g['totals'] = collect($g['totals'])->map(fn ($q, $u) => ['unit' => (string) $u, 'qty' => $q])->sortByDesc('qty')->values()->all();
            $g['stock_sum'] = array_sum(array_column($g['totals'], 'qty'));

            return $g;
        })->sortBy(fn ($g) => [$g['brand'] === null ? 1 : 0, -$g['stock_sum'], $g['brand']])->values(); // stock first, unclear last

        $all = [];
        foreach ($rows as $g) {
            foreach ($g['totals'] as $t) {
                $all[$t['unit']] = round(($all[$t['unit']] ?? 0) + $t['qty'], 2);
            }
        }

        return [
            'query' => $query, 'exclude_used' => $excludeUsed, 'exclude_damaged' => $excludeDamaged,
            'items_count' => $rows->sum('items_count'),
            'brands_count' => $rows->whereNotNull('brand')->count(),
            'totals' => collect($all)->map(fn ($q, $u) => ['unit' => (string) $u, 'qty' => $q])->sortByDesc('qty')->values()->all(),
            'truncated' => count($matches) > $limit,
            'groups' => $rows->map(fn ($g) => collect($g)->except('stock_sum')->all())->all(),
        ];
    }

    /** The condition written at the start of a name: (BEKAS) used, (RUSAK) damaged, (VULKANISIR) retreaded. */
    public static function condition(string $name): ?string
    {
        return preg_match('/^\s*\((BEKAS|RUSAK|VULKANISIR)\)/i', $name, $m) ? strtoupper($m[1]) : null;
    }

    public static function totalsText(array $totals): string
    {
        return $totals === [] ? '0' : implode(' + ', array_map(fn ($t) => rtrim(rtrim(number_format((float) $t['qty'], 2, ',', '.'), '0'), ',').' '.$t['unit'], $totals));
    }

    /** @return list<string> the brands found among the matches, most items first */
    public function brands(array $matches): array
    {
        return collect($matches)->pluck('brand')->filter()->countBy()->sortDesc()->keys()->all();
    }

    /** @return array<int, int> item id => best weight of this word (exact 30, synonym 28, start 20, typo 10) */
    private function matchesFor(string $t, array $inv): array
    {
        $w = [];
        $add = function (array $ids, int $weight) use (&$w) {
            foreach ($ids as $id) {
                if (($w[$id] ?? 0) < $weight) {
                    $w[$id] = $weight;
                }
            }
        };
        $add($inv[$t] ?? [], 30);
        foreach (self::SYNONYMS[$t] ?? [] as $syn) {
            $add($inv[$syn] ?? [], 28);
        }
        $len = strlen($t);
        $isNumber = (bool) preg_match('/^\d+(\.\d+)?$/', $t);
        foreach ($inv as $word => $ids) {
            $word = (string) $word;
            if ($word === $t || str_starts_with($word, 'SZ')) {
                continue;
            }
            if ($len >= 2 && str_starts_with($word, $t) && ! $isNumber) {
                $add($ids, 20);
            } elseif ($len >= 4 && ! $isNumber && abs(strlen($word) - $len) <= 2 && ! preg_match('/\d/', $word)
                && levenshtein($t, $word) <= ($len >= 8 ? 2 : 1)) {
                $add($ids, 10);
            }
        }

        return $w;
    }

    /** @return array<int, array{0:int, 1:int}> items matching at least $need of the terms => [sum, weakest] */
    private function combine(array $perTerm, int $need, array $required): array
    {
        $hits = [];
        foreach ($perTerm as $i => $weights) {
            foreach ($weights as $id => $weight) {
                $hits[$id][$i] = $weight;
            }
        }
        $out = [];
        foreach ($hits as $id => $byTerm) {
            if (count($byTerm) >= $need && ! array_filter($required, fn ($req, $i) => $req && ! isset($byTerm[$i]), ARRAY_FILTER_USE_BOTH)) {
                $out[$id] = [array_sum($byTerm), count($byTerm) === count($perTerm) ? min($byTerm) : 0];
            }
        }

        return $out;
    }

    private function sorted(array $out): array
    {
        $items = $this->index()['items'];
        uksort($out, fn ($a, $b) => [$out[$b]['score'], $items[$a]['c']] <=> [$out[$a]['score'], $items[$b]['c']]);

        return $out;
    }
}
