<?php

namespace Tests\Feature;

use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** E-sign: each user sets / removes their own; served through a signed URL. */
class UserSignatureTest extends TestCase
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

    public function test_a_user_sets_changes_and_removes_their_e_sign(): void
    {
        Storage::fake('local');
        $user = $this->actingAsRole('karyawan');
        $this->getJson('/api/me')->assertJsonPath('user.signature_url', null);
        $this->postJson('/api/me/signature', ['image' => 'data:text/plain;base64,aGk='])->assertStatus(422);
        $this->postJson('/api/me/signature', ['image' => 'data:image/png;base64,bm90IGFuIGltYWdl'])->assertStatus(422);

        $url = $this->postJson('/api/me/signature', ['image' => $this->png(1200, 300)])->assertOk()->json('user.signature_url');
        $this->assertStringStartsWith("/api/signatures/{$user->id}?v=", $url);
        $first = $user->fresh()->signature_path;
        // a signature keeps its wide aspect ratio, not cropped square like the photo
        [$w, $h] = getimagesizefromstring(Storage::disk('local')->get($first));
        $this->assertSame(800, $w);
        $this->assertSame(200, $h);

        // the image needs no token, but the signature
        app('auth')->forgetGuards();
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->get(preg_replace('/s=\w+/', 's=wrong', $url))->assertNotFound();

        Sanctum::actingAs($user);
        $this->postJson('/api/me/signature', ['image' => $this->png(600, 200)])->assertOk();
        Storage::disk('local')->assertMissing($first);
        $this->deleteJson('/api/me/signature')->assertOk()->assertJsonPath('user.signature_url', null);
        $this->assertNull($user->fresh()->signature_path);
    }

    public function test_another_users_signature_is_not_served_without_its_url(): void
    {
        Storage::fake('local');
        $user = $this->actingAsRole('karyawan');
        $url = $this->postJson('/api/me/signature', ['image' => $this->png(300, 150)])->assertOk()->json('user.signature_url');

        $other = $this->actingAsRole('admin_gudang');
        // another user cannot guess the path: the URL carries its own signature
        $this->get("/api/signatures/{$other->id}")->assertNotFound();
    }
}
