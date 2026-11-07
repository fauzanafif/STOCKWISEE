<?php

namespace Tests\Feature;

use App\Models\UpdateAlert;
use App\Models\UpdateAlertView;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UpdateAlertThumbsTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function alert(string $mode = 'once', ?int $interval = null): UpdateAlert
    {
        return UpdateAlert::create(['title' => 'New', 'message' => 'Hello', 'type' => 'info', 'display_mode' => $mode, 'interval_minutes' => $interval, 'is_active' => true]);
    }

    public function test_a_thumbs_up_closes_the_alert_and_is_listed_with_who_and_when(): void
    {
        $alert = $this->alert();
        $siti = $this->actingAsRole('karyawan', ['name' => 'Siti']);
        $this->assertSame([$alert->id], array_column($this->getJson('/api/update-alerts/due')->json('data'), 'id'));
        $this->postJson("/api/update-alerts/{$alert->id}/thumbs-up")->assertOk();
        $this->assertSame([], $this->getJson('/api/update-alerts/due')->json('data'), 'closed like any other way');

        // closing it without a thumb is not a thumbs up
        $this->actingAsRole('karyawan', ['name' => 'Budi']);
        $this->postJson("/api/update-alerts/{$alert->id}/seen")->assertOk();

        $this->actingAsRole('super_admin');
        $row = $this->getJson('/api/update-alerts')->assertOk()->json('data.0');
        $this->assertSame([2, 1], [$row['seen_count'], $row['thumbs_count']]);
        $list = $this->getJson("/api/update-alerts/{$alert->id}/thumbs-up")->assertOk()->json('data');
        $this->assertSame(['Siti'], array_column($list, 'name'));
        // everyone who closed it, by name, the thumb marked
        $closed = collect($this->getJson("/api/update-alerts/{$alert->id}/closed-by")->assertOk()->json('data'))->keyBy('name');
        $this->assertEqualsCanonicalizing(['Siti', 'Budi'], $closed->keys()->all());
        $this->assertSame([true, false], [$closed['Siti']['thumbs_up'], $closed['Budi']['thumbs_up']]);
        $this->assertNotNull($closed['Budi']['at']);
        $this->assertSame($siti->username, $list[0]['username']);
        $this->assertNotNull($list[0]['at']);
    }

    public function test_a_repeating_alert_keeps_the_first_thumb_and_counts_each_person_once(): void
    {
        $alert = $this->alert('interval', 30);
        $user = $this->actingAsRole('karyawan');
        $this->postJson("/api/update-alerts/{$alert->id}/thumbs-up")->assertOk();
        $first = UpdateAlertView::where(['update_alert_id' => $alert->id, 'user_id' => $user->id])->value('thumbed_up_at');
        $this->travel(2)->hours();
        $this->assertCount(1, $this->getJson('/api/update-alerts/due')->json('data'), 'due again');
        $this->postJson("/api/update-alerts/{$alert->id}/thumbs-up")->assertOk();
        $view = UpdateAlertView::where(['update_alert_id' => $alert->id, 'user_id' => $user->id])->sole();
        $this->assertEquals($first, $view->getRawOriginal('thumbed_up_at'));
        $this->assertSame([], $this->getJson('/api/update-alerts/due')->json('data'), 'its schedule counts from now');
        $this->actingAsRole('super_admin');
        $this->assertSame(1, $this->getJson('/api/update-alerts')->json('data.0.thumbs_count'));
    }

    public function test_a_close_after_a_thumb_does_not_undo_it_and_only_the_super_admin_sees_the_list(): void
    {
        $alert = $this->alert();
        $this->actingAsRole('karyawan');
        $this->postJson("/api/update-alerts/{$alert->id}/thumbs-up")->assertOk();
        $this->postJson("/api/update-alerts/{$alert->id}/seen")->assertOk();
        $this->assertSame(1, UpdateAlertView::whereNotNull('thumbed_up_at')->count());
        $this->getJson("/api/update-alerts/{$alert->id}/thumbs-up")->assertForbidden();
        $this->getJson("/api/update-alerts/{$alert->id}/closed-by")->assertForbidden();
    }
}
