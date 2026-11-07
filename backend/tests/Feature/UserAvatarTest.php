<?php

namespace Tests\Feature;

use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Profile photo: each user sets / removes their own; served through a signed URL. */
class UserAvatarTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function png(int $w, int $h): string
    {
        $img = imagecreatetruecolor($w, $h);
        ob_start();
        imagepng($img);

        return 'data:image/png;base64,'.base64_encode(ob_get_clean());
    }

    public function test_a_user_sets_changes_and_removes_their_photo(): void
    {
        Storage::fake('local');
        $user = $this->actingAsRole('karyawan');
        $this->getJson('/api/me')->assertJsonPath('user.avatar_url', null);
        $this->postJson('/api/me/avatar', ['image' => 'data:text/plain;base64,aGk='])->assertStatus(422);
        $this->postJson('/api/me/avatar', ['image' => 'data:image/png;base64,bm90IGFuIGltYWdl'])->assertStatus(422);

        $url = $this->postJson('/api/me/avatar', ['image' => $this->png(600, 400)])->assertOk()->json('user.avatar_url');
        $this->assertStringStartsWith("/api/avatars/{$user->id}?v=", $url);
        $first = $user->fresh()->avatar_path;
        [$w, $h] = getimagesizefromstring(Storage::disk('local')->get($first));
        $this->assertSame([256, 256], [$w, $h], 'cropped square, 256px');

        // the image needs no token, but the signature
        app('auth')->forgetGuards();
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/jpeg');
        $this->get(preg_replace('/s=\w+/', 's=wrong', $url))->assertNotFound();

        \Laravel\Sanctum\Sanctum::actingAs($user);
        $this->postJson('/api/me/avatar', ['image' => $this->png(100, 300)])->assertOk();
        Storage::disk('local')->assertMissing($first);
        $this->deleteJson('/api/me/avatar')->assertOk()->assertJsonPath('user.avatar_url', null);
        $this->assertNull($user->fresh()->avatar_path);
    }
}
