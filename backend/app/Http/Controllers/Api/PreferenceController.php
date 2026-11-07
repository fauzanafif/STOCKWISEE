<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** GET / PUT /api/preferences/{key} — the user's own settings (e.g. a dashboard's layout), on any device. */
class PreferenceController extends Controller
{
    public const KEY = '/^[a-z0-9_.:-]{1,80}$/';

    public function show(Request $request, string $key): JsonResponse
    {
        abort_unless(preg_match(self::KEY, $key), 404);
        $value = DB::table('user_preferences')->where(['user_id' => $request->user()->id, 'key' => $key])->value('value');

        return response()->json(['data' => $value !== null ? json_decode($value, true) : null]);
    }

    public function update(Request $request, string $key): JsonResponse
    {
        abort_unless(preg_match(self::KEY, $key), 404);
        $data = $request->validate(['value' => ['present', 'nullable', 'array']]);
        $json = json_encode($data['value']);
        abort_if(strlen((string) $json) > 20000, 422, 'Pengaturan terlalu besar.');
        if ($data['value'] === null) {
            DB::table('user_preferences')->where(['user_id' => $request->user()->id, 'key' => $key])->delete();
        } else {
            DB::table('user_preferences')->updateOrInsert(['user_id' => $request->user()->id, 'key' => $key], ['value' => $json, 'updated_at' => now(), 'created_at' => now()]);
        }

        return response()->json(['data' => $data['value']]);
    }
}
