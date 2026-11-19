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

/** E-sign: each user uploads or draws their own signature; shown through a signed URL (an <img> sends no token). */
class SignatureController extends Controller
{
    private const MAX_WIDTH = 800;

    /** POST /api/me/signature {image: data URL} — keeps the aspect ratio (a signature is wide, not square), PNG with alpha. */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(['image' => ['required', 'string', 'max:12000000']]);
        if (! preg_match('#^data:image/(png|jpe?g|webp);base64,#i', $data['image'])) {
            throw ValidationException::withMessages(['image' => 'File harus gambar (JPG, PNG, WEBP).']);
        }
        $raw = base64_decode(substr($data['image'], strpos($data['image'], ',') + 1), true);
        $src = $raw !== false && @getimagesizefromstring($raw) ? @imagecreatefromstring($raw) : false;
        if (! $src) {
            throw ValidationException::withMessages(['image' => 'Gambar tidak bisa dibaca. Coba file lain.']);
        }

        $w = imagesx($src);
        $h = imagesy($src);
        $scale = min(1.0, self::MAX_WIDTH / $w);
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $dst = imagecreatetruecolor($nw, $nh);
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefill($dst, 0, 0, $transparent);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
        ob_start();
        imagepng($dst, null, 6);
        $png = ob_get_clean();
        imagedestroy($src);
        imagedestroy($dst);

        $user = $request->user();
        $old = $user->signature_path;
        $path = 'signatures/'.$user->id.'-'.now()->format('YmdHis').'-'.Str::random(6).'.png';
        Storage::disk('local')->put($path, $png);
        $user->forceFill(['signature_path' => $path, 'signature_updated_at' => now()])->save();
        if ($old && $old !== $path) {
            Storage::disk('local')->delete($old);
        }

        return response()->json(['user' => new UserResource($user->load('site', 'roles'))]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->signature_path) {
            Storage::disk('local')->delete($user->signature_path);
        }
        $user->forceFill(['signature_path' => null, 'signature_updated_at' => now()])->save();

        return response()->json(['user' => new UserResource($user->load('site', 'roles'))]);
    }

    /** GET /api/signatures/{user}?v=&s= — the signature, for whoever holds its signed URL (User::signatureUrl). */
    public function show(Request $request, User $user): StreamedResponse
    {
        $v = (string) $request->query('v', '');
        abort_unless($user->signature_path && hash_equals(User::signatureSignature($user->id, $v), (string) $request->query('s', '')), 404);
        abort_unless(Storage::disk('local')->exists($user->signature_path), 404);

        return Storage::disk('local')->response($user->signature_path, null, ['Content-Type' => 'image/png', 'Cache-Control' => 'private, max-age=604800']);
    }
}
