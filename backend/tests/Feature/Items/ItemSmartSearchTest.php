<?php

namespace Tests\Feature\Items;

use App\Models\Item;
use App\Services\Search\ItemSmartSearch;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Smart Search of the Master Barang. The names are written exactly the way the real Master Barang writes them
 * (copied from it); the original code and name are never changed by searching.
 */
class ItemSmartSearchTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private const NAMES = [
        'AUT.0001' => '(VULKANISIR) BAN LUAR NYLON - BRIDGESTONE / 7.50-16 TT / MIGHTY RIB',
        'AUT.0021' => 'BAN LUAR NYLON - BRIDGESTONE / 7.50-16 TT / MIGHTY RIB',
        'AUT.0031' => 'BAN LUAR NYLON - GAJAH TUNGGAL / 7.50-16 TT / GT SUPER 88N',
        'AUT.0040' => '(VULKANISIR) BAN LUAR STEEL - GITI / 7.50-R16 TT / GAR890',
        'AUT.0079' => 'BAN DALAM - AEOLUS / (7.50)-16',
        'AUT.0082' => 'BAN DALAM - EVERSAVE HD / (7.50/8.25)-16',
        'AUT.0002' => '(VULKANISIR) BAN LUAR NYLON - DOUBLE COIN / 10.00-20 TT / RR9',
        'AUT.0007' => '(VULKANISIR) BAN LUAR NYLON - GAJAH TUNGGAL / 7.00-14 TT / GT SUPER',
        'AUT.0134' => 'BEARING RODA DEPAN DALAM U/LOHAN - KOYO / 32313JR',
        'AUT.0135' => 'BEARING RODA DEPAN LUAR U/CANTER - KOYO / 32207JRYA3',
        'SPR.9006' => 'Baut M12 x 40',
        'SSP.2165' => 'DYNABOLT M12 GI - P = 100mm',
        'EAE.0120' => 'KABEL LISTRIK ENGKEL NYA - ETERNA / 1 x 2.5mm',
        'ELK.9001' => 'Kabel NYA 2,5 mm',
        'HHN.0150' => 'GEMBOK PANZER KOTAK - LOKAL / 60mm',
        'BSP.0001' => 'BAUT 1100-20 - LOKAL', // a number pattern that is not a tyre size
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        foreach (self::NAMES as $code => $name) {
            Item::factory()->create(['code' => $code, 'description' => $name, 'is_active' => true]);
        }
        $this->actingAsRole('admin_gudang');
    }

    private function codes(string $search, array $extra = []): array
    {
        return array_column($this->getJson('/api/items?'.http_build_query(['search' => $search, 'per_page' => 50] + $extra))->assertOk()->json('data'), 'code');
    }

    public function test_every_way_of_writing_a_tyre_size_finds_the_same_tyres_and_no_other_size(): void
    {
        $expected = ['AUT.0001', 'AUT.0021', 'AUT.0031', 'AUT.0040', 'AUT.0079', 'AUT.0082'];
        foreach (['Ban 7.50 R16', 'Ban 750-16', 'Ban 7.50-16', 'TYRE 750 R16', 'ban 750/16', 'ban 7.50-r16'] as $q) {
            $found = $this->codes($q);
            sort($found);
            $this->assertSame($expected, $found, $q);
        }
        // 10.00-20 / 7.00-14 never mixed in; a bolt "1100-20" is not a tyre
        $this->assertSame(['AUT.0002'], $this->codes('ban 10.00-20'));
        $this->assertSame([], $this->codes('ban 1100-20'));
        $this->assertSame(['AUT.0082'], $this->codes('ban 8.25-16'));
    }

    public function test_code_first_typos_specs_brands_and_partial_words(): void
    {
        $this->assertSame('AUT.0021', $this->codes('AUT.0021')[0]);
        $this->assertSame('AUT.0021', $this->codes('aut.0021')[0]);
        $this->assertSame(['AUT.0001', 'AUT.0021'], $this->codes('bridgestne 7.50-16'));             // typo
        $this->assertEqualsCanonicalizing(['AUT.0134', 'AUT.0135'], $this->codes('bering koyo'));    // typo
        $this->assertEqualsCanonicalizing(['SPR.9006'], $this->codes('baut m12'));
        $this->assertEqualsCanonicalizing(['EAE.0120', 'ELK.9001'], $this->codes('kabel nya 2.5mm')); // "2,5 mm" = "2.5mm"
        $this->assertSame([], $this->codes('bearing 6204'));                                         // never a bearing of another number
        $this->assertSame(['AUT.0031'], $this->codes('tunggal 7.50'));                               // a word of the brand
        $this->assertContains('HHN.0150', $this->codes('box'));                                      // synonym BOX ↔ KOTAK
        $this->assertContains('AUT.0134', $this->codes('bear'));                                     // start of a word
    }

    public function test_relevance_brands_and_brand_filter_never_change_the_original_data(): void
    {
        $res = $this->getJson('/api/items?search='.urlencode('Ban 7.50 R16'))->assertOk()->json();
        $first = $res['data'][0];
        $this->assertSame('Same size', $res['meta']['search']['relevance'][$first['id']]);
        $this->assertEqualsCanonicalizing(['BRIDGESTONE', 'GAJAH TUNGGAL'], $res['meta']['search']['brands']); // only brands of 2+ items
        $this->assertSame(['AUT.0001', 'AUT.0021'], $this->codes('Ban 7.50 R16', ['brand' => 'BRIDGESTONE']));
        // the exact (old) mode is still there, and a column sort still wins over relevance
        $this->assertSame([], $this->codes('Ban 7.50 R16', ['search_mode' => 'exact']));
        $this->assertSame(['AUT.0001', 'AUT.0021', 'AUT.0031', 'AUT.0040', 'AUT.0079', 'AUT.0082'], $this->codes('Ban 7.50 R16', ['sort' => 'code']));
        // nothing about the items changed
        foreach (self::NAMES as $code => $name) {
            $this->assertSame($name, Item::where('code', $code)->value('description'));
        }
    }

    public function test_brand_summary_counts_items_and_stock_per_brand_and_unit(): void
    {
        $wh = \App\Models\Warehouse::factory()->create()->id;
        $ledger = app(\App\Services\Inventory\StockLedgerService::class);
        foreach (['AUT.0001' => 2, 'AUT.0021' => 6, 'AUT.0031' => 4, 'AUT.0040' => 0] as $code => $qty) {
            $ledger->openingBalance(Item::where('code', $code)->value('id'), $wh, $qty);
        }
        Item::factory()->create(['code' => 'PUI.0094', 'description' => '(BEKAS) BAN LUAR NYLON - BRIDGESTONE / 7.50-16 TT / MIGHTY RIB', 'is_active' => true, 'accurate_qty_onhand' => 3]);

        $d = $this->getJson('/api/items/smart-search?q='.urlencode('Ban 7.50 R16'))->assertOk()->json('data');
        $g = collect($d['groups'])->keyBy(fn ($x) => $x['brand'] ?? '');
        // BRIDGESTONE: 3 item types (one used), 2 + 6 + 3 = 11 PCS; GAJAH TUNGGAL 1 item 4 PCS; unclear brands kept apart
        $sum = fn ($grp) => (float) array_sum(array_column($grp['totals'], 'qty')); // summed per unit; the test items have assorted units
        $this->assertSame([3, 11.0], [$g['BRIDGESTONE']['items_count'], $sum($g['BRIDGESTONE'])]);
        $this->assertSame([1, 4.0], [$g['GAJAH TUNGGAL']['items_count'], $sum($g['GAJAH TUNGGAL'])]);
        $this->assertSame('BEKAS', collect($g['BRIDGESTONE']['items'])->firstWhere('code', 'PUI.0094')['condition']);
        $this->assertSame([], array_values(array_filter(array_slice($d['groups'], 0, -1), fn ($x) => $x['brand'] === null)), 'the unclear-brand group is last');
        // a damaged one is not left out by "exclude used" (a used item may still be usable: two separate choices)
        Item::factory()->create(['code' => 'PUI.0466', 'description' => '(RUSAK) BAN LUAR NYLON - BRIDGESTONE / 7.50-16 TT / MIGHTY RIB', 'is_active' => true, 'accurate_qty_onhand' => 1]);
        $only = fn (string $flags) => collect($this->getJson("/api/items/smart-search?{$flags}&q=".urlencode('Ban 7.50 R16'))->assertOk()->json('data.groups'))->firstWhere('brand', 'BRIDGESTONE')['items_count'];
        $this->assertSame([4, 3, 3, 2], [$only('x=1'), $only('exclude_used=1'), $only('exclude_damaged=1'), $only('exclude_used=1&exclude_damaged=1')]);
        // used and damaged left out on request
        $d = $this->getJson('/api/items/smart-search?exclude_used=1&exclude_damaged=1&q='.urlencode('Ban 7.50 R16'))->assertOk()->json('data');
        $bs = collect($d['groups'])->firstWhere('brand', 'BRIDGESTONE');
        $this->assertSame([2, 8.0], [$bs['items_count'], (float) array_sum(array_column($bs['totals'], 'qty'))]);
        $this->getJson('/api/items/smart-search?q=a')->assertStatus(422);
        $this->actingAsRole('karyawan');
        $this->getJson('/api/items/smart-search?q=ban')->assertForbidden();
    }

    public function test_the_index_follows_changes_like_an_accurate_sync(): void
    {
        $this->assertSame([], $this->codes('ban 9.00-20'));
        // the sync adds an item (newer updated_at): the next search sees it without any manual step
        $this->travel(1)->minutes();
        Item::factory()->create(['code' => 'AUT.0090', 'description' => 'BAN DALAM - GAJAH TUNGGAL / (9.00)-20', 'is_active' => true]);
        $this->assertSame(['AUT.0090'], $this->codes('ban 900-20'));
        $this->assertSame(['SZ900-20'], ItemSmartSearch::sizes('BAN DALAM / (9.00)-20')[0]);
    }
}
