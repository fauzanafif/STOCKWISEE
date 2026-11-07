<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\AutoRefresh;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Settings · Auto Refresh: the Super Admin role only (the interval sets the load of the whole server). */
class AutoRefreshController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $this->superAdminOnly($request);

        return response()->json(['data' => AutoRefresh::get()]);
    }

    public function update(Request $request): JsonResponse
    {
        $this->superAdminOnly($request);
        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'seconds' => ['required', 'integer', 'min:'.AutoRefresh::MIN_SECONDS, 'max:'.AutoRefresh::MAX_SECONDS],
        ]);
        AutoRefresh::put(['enabled' => (bool) $data['enabled'], 'seconds' => (int) $data['seconds']]);

        return response()->json(['data' => AutoRefresh::get()]);
    }

    private function superAdminOnly(Request $request): void
    {
        abort_unless($request->user()->hasRole('super_admin'), 403, 'Super Admin only.');
    }
}
