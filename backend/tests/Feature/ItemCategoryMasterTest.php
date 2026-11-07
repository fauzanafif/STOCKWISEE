<?php

namespace Tests\Feature;

use App\Models\Item;
use App\Support\ItemOptions;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Master Kategori Barang: the Master Produk category choices, kept in the database. */
class ItemCategoryMasterTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_starts_from_the_fixed_lists_with_the_induk_prefixes(): void
    {
        $this->assertSame(ItemOptions::defaults()['induk'], ItemOptions::categories()['accurate_category_induk']);
        $this->assertSame('MAA,MNA', DB::table('item_category_options')->where(['level' => 'induk', 'name' => 'Manufacture & Assembly'])->value('code_prefix'));
        $this->assertSame('Manufacture & Assembly', ItemOptions::indukByPrefix()['MNA']);
    }

    public function test_add_rename_deactivate_and_delete(): void
    {
        $item = Item::factory()->create(['accurate_category_anak_1' => 'BAUT']);
        $this->actingAsRole('super_admin');

        $made = $this->postJson('/api/item-categories', ['level' => 'induk', 'name' => '  Bahan  Baku ', 'code_prefix' => 'bbk, xyz'])->assertCreated()->json('data');
        $this->assertSame(['Bahan Baku', 'BBK,XYZ'], [$made['name'], $made['code_prefix']]);
        $this->postJson('/api/item-categories', ['level' => 'induk', 'name' => 'bahan baku'])->assertStatus(422)->assertJsonValidationErrors('name');
        $this->postJson('/api/item-categories', ['level' => 'induk', 'name' => 'Lain', 'code_prefix' => 'MNA'])->assertStatus(422)->assertJsonValidationErrors('code_prefix');
        $this->postJson('/api/item-categories', ['level' => 'induk', 'name' => 'Lain', 'code_prefix' => 'TOOLONG'])->assertStatus(422)->assertJsonValidationErrors('code_prefix');
        $this->assertSame('Bahan Baku', ItemOptions::indukByPrefix()['BBK']);
        $this->assertContains('Bahan Baku', ItemOptions::categories()['accurate_category_induk']);

        // a rename moves the items along; one in use can't be deleted
        $baut = DB::table('item_category_options')->where(['level' => 'anak_1', 'name' => 'BAUT'])->value('id');
        $list = $this->getJson('/api/item-categories?level=anak_1')->assertOk()->json('data');
        $this->assertSame(1, collect($list)->firstWhere('name', 'BAUT')['items_count']);
        $this->putJson("/api/item-categories/{$baut}", ['name' => 'BAUT & MUR'])->assertOk()->assertJsonPath('items_moved', 1);
        $this->assertSame('BAUT & MUR', $item->fresh()->accurate_category_anak_1);
        $this->deleteJson("/api/item-categories/{$baut}")->assertStatus(422);

        // inactive: no longer offered in the Master Produk form
        $this->putJson("/api/item-categories/{$made['id']}", ['is_active' => false])->assertOk();
        $this->assertNotContains('Bahan Baku', ItemOptions::categories()['accurate_category_induk']);
        $this->deleteJson("/api/item-categories/{$made['id']}")->assertOk();

        // a value items carry that isn't listed shows up to be added
        Item::factory()->create(['accurate_category_anak_2' => 'BARU DARI ACCURATE']);
        $this->assertSame([['name' => 'BARU DARI ACCURATE', 'items_count' => 1]], $this->getJson('/api/item-categories?level=anak_2')->json('unlisted'));

        $this->actingAsRole('karyawan');
        $this->postJson('/api/item-categories', ['level' => 'induk', 'name' => 'X'])->assertForbidden();
    }
}
