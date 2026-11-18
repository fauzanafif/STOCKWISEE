<?php

namespace Tests\Feature;

use App\Models\CustomDashboard;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Custom dashboards: their layout is kept per user; Personal or Shared; only the owner changes one. */
class CustomDashboardTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function body(array $extra = []): array
    {
        // what a test passes wins over the defaults
        return $extra + [
            'name' => 'Pengadaan minggu ini', 'description' => 'PR dan PO', 'icon' => 'shopping-cart', 'visibility' => 'PERSONAL', 'app_key' => 'purchase',
            'widgets' => [
                ['id' => 'w1', 'type' => 'kpi', 'source' => 'stats.po', 'title' => 'Angka PO', 'w' => 12, 'h' => 1],
                ['id' => 'w2', 'type' => 'line', 'source' => 'stats.ppb', 'title' => null, 'w' => 6, 'h' => 2],
                ['id' => 'w3', 'type' => 'list', 'source' => 'todo.po', 'w' => 6, 'h' => 2],
            ],
        ];
    }

    public function test_a_dashboard_is_made_kept_changed_and_deleted_by_its_owner(): void
    {
        $this->actingAsRole('purchasing');
        $d = $this->postJson('/api/custom-dashboards', $this->body())->assertCreated()->json('data');
        $this->assertSame(['w1', 'w2', 'w3'], array_column($d['widgets'], 'id'));
        $this->assertTrue($d['mine']);

        // the layout is kept: a new order, a widget resized, retitled and one removed
        $layout = $this->body(['name' => 'Pengadaan', 'widgets' => [
            ['id' => 'w3', 'type' => 'list', 'source' => 'todo.po', 'w' => 4, 'h' => 3],
            ['id' => 'w1', 'type' => 'kpi', 'source' => 'stats.po', 'title' => 'PO', 'w' => 8, 'h' => 1],
        ]]);
        $this->putJson("/api/custom-dashboards/{$d['id']}", $layout)->assertOk();
        $again = $this->getJson("/api/custom-dashboards/{$d['id']}")->assertOk()->json('data');
        $this->assertSame('Pengadaan', $again['name']);
        $this->assertSame([['w3', 4, 3], ['w1', 8, 1]], array_map(fn ($w) => [$w['id'], $w['w'], $w['h']], $again['widgets']));
        $this->assertSame('PO', $again['widgets'][1]['title']);
        $this->assertSame([$d['id']], array_column($this->getJson('/api/custom-dashboards?app=purchase')->json('data'), 'id'));
        $this->assertSame([], $this->getJson('/api/custom-dashboards?app=inventory')->json('data'));

        $this->deleteJson("/api/custom-dashboards/{$d['id']}")->assertOk();
        $this->assertSame(0, CustomDashboard::count());
    }

    public function test_personal_is_the_owners_alone_shared_opens_for_everyone_and_only_the_owner_changes_it(): void
    {
        $owner = $this->actingAsRole('purchasing');
        $mine = $this->postJson('/api/custom-dashboards', $this->body())->json('data');
        $shared = $this->postJson('/api/custom-dashboards', $this->body(['name' => 'Bersama', 'visibility' => 'SHARED']))->json('data');

        $this->actingAsRole('manager');
        $this->assertSame([$shared['id']], array_column($this->getJson('/api/custom-dashboards')->assertOk()->json('data'), 'id'));
        $this->getJson("/api/custom-dashboards/{$mine['id']}")->assertNotFound();
        $this->getJson("/api/custom-dashboards/{$shared['id']}")->assertOk()->assertJsonPath('data.can_edit', false);
        $this->putJson("/api/custom-dashboards/{$shared['id']}", $this->body(['visibility' => 'SHARED']))->assertForbidden();
        $this->deleteJson("/api/custom-dashboards/{$shared['id']}")->assertForbidden();

        // Super Admin may clear a shared one left behind
        $this->actingAsRole('super_admin');
        $this->deleteJson("/api/custom-dashboards/{$shared['id']}")->assertOk();
        $this->assertSame(1, CustomDashboard::where('user_id', $owner->id)->count());
    }

    public function test_a_widget_is_one_the_catalog_has(): void
    {
        $this->actingAsRole('purchasing');
        $bad = fn (array $w) => $this->postJson('/api/custom-dashboards', $this->body(['widgets' => [['id' => 'x', 'w' => 6, 'h' => 2] + $w]]))->assertUnprocessable();
        $bad(['type' => 'kpi', 'source' => 'stats.salary']);   // no such source
        $bad(['type' => 'line', 'source' => 'approvals']);      // a list source has no chart
        $this->postJson('/api/custom-dashboards', $this->body(['widgets' => [['id' => 'x', 'type' => 'kpi', 'source' => 'stats.po', 'w' => 5, 'h' => 1]]]))->assertUnprocessable();
        $this->postJson('/api/custom-dashboards', $this->body(['icon' => 'skull']))->assertUnprocessable();
    }

    public function test_it_needs_a_signed_in_user(): void
    {
        $this->getJson('/api/custom-dashboards')->assertUnauthorized();
    }
}
