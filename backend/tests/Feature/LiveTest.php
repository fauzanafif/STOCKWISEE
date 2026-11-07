<?php

namespace Tests\Feature;

use App\Models\ItemRequest;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** /api/live: a stamp per area that changes when another account changes something there, only there. */
class LiveTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_a_change_in_one_area_changes_only_its_stamp(): void
    {
        $this->actingAsRole('karyawan');
        $before = $this->getJson('/api/live')->assertOk()->json('data');
        $this->assertSame(['request', 'important', 'purchasing', 'alerts', 'notifications'], array_keys($before));
        $this->assertSame($before, $this->getJson('/api/live')->json('data'), 'nothing changed: same stamps');

        // another account makes a request
        $r = ItemRequest::create(['number' => 'REQ/1', 'requester_name' => 'Budi', 'status' => 'MENUNGGU', 'source' => 'APP']);
        $after = $this->getJson('/api/live')->json('data');
        $this->assertNotSame($before['request'], $after['request']);
        $this->assertSame([$before['important'], $before['purchasing']], [$after['important'], $after['purchasing']]);

        // deleted: changes too
        $r->delete();
        $this->assertNotSame($after['request'], $this->getJson('/api/live')->json('data.request'));
    }
}
