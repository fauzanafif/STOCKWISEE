<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/** How often every open tab asks /api/live what changed. One setting for the whole system: it sets the server's load. */
class AutoRefresh
{
    private const KEY = 'auto_refresh';

    public const MIN_SECONDS = 3;

    public const MAX_SECONDS = 600;

    /** @return array{enabled: bool, seconds: int} */
    public static function get(): array
    {
        $value = DB::table('app_settings')->where('key', self::KEY)->value('value');

        return ($value ? json_decode($value, true) : null) ?? ['enabled' => true, 'seconds' => 15];
    }

    /** @param array{enabled: bool, seconds: int} $settings */
    public static function put(array $settings): void
    {
        DB::table('app_settings')->upsert(
            [['key' => self::KEY, 'value' => json_encode($settings), 'updated_at' => now()]],
            ['key'],
            ['value', 'updated_at'],
        );
    }
}
