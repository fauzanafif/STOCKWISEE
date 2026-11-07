<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Profile photo: each user sets / removes their own; shown through a signed URL (an <img> sends no token). */
class AvatarController extends Controller
{
    private const SIZE = 256;

    /** POST /api/me/avatar {image: data URL} — cropped to a square, 256px JPEG. */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(['image' => ['required', 'string', 'max:15000000']]);
        if (! preg_match('#^data:image/(png|jpe?g|webp|gif);base64,#i', $data['image'])) {
            throw ValidationException::withMessages(['image' => 'File harus gambar (JPG, PNG, WEBP).']);
        }
        $raw = base64_decode(substr($data['image'], strpos($data['image'], ',') + 1), true);
        $src = $raw !== false && @getimagesizefromstring($raw) ? @imagecreatefromstring($raw) : false;
        if (! $src) {
            throw ValidationException::withMessages(['image' => 'Gambar tidak bisa dibaca. Coba file lain.']);
        }
        $w = imagesx($src);
        $h = imagesy($src);
        $side = min($w, $h);
        $dst = imagecreatetruecolor(self::SIZE, self::SIZE);
        imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
        imagecopyresampled($dst, $src, 0, 0, intdiv($w - $side, 2), intdiv($h - $side, 2), self::SIZE, self::SIZE, $side, $side);
        ob_start();
        imagejpeg($dst, null, 85);
        $jpeg = ob_get_clean();
        imagedestroy($src);
        imagedestroy($dst);

        $user = $request->user();
        $old = $user->avatar_path;
        $path = 'avatars/'.$user->id.'-'.now()->format('YmdHis').'-'.Str::random(6).'.jpg';
        Storage::disk('local')->put($path, $jpeg);
        $user->forceFill(['avatar_path' => $path, 'avatar_updated_at' => now()])->save();
        if ($old && $old !== $path) {
            Storage::disk('local')->delete($old);
        }

        return response()->json(['user' => new UserResource($user->load('site', 'roles'))]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->avatar_path) {
            Storage::disk('local')->delete($user->avatar_path);
        }
        $user->forceFill(['avatar_path' => null, 'avatar_updated_at' => now()])->save();

        return response()->json(['user' => new UserResource($user->load('site', 'roles'))]);
    }

    /** GET /api/avatars/{user}?v=&s= — the photo, for whoever holds its signed URL (User::avatarUrl). */
    public function show(Request $request, User $user): StreamedResponse
    {
        $v = (string) $request->query('v', '');
        abort_unless($user->avatar_path && hash_equals(User::avatarSignature($user->id, $v), (string) $request->query('s', '')), 404);
        abort_unless(Storage::disk('local')->exists($user->avatar_path), 404);

        return Storage::disk('local')->response($user->avatar_path, null, ['Content-Type' => 'image/jpeg', 'Cache-Control' => 'private, max-age=604800']);
    }
}
