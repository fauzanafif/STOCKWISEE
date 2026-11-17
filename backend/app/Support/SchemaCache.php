<?php

namespace App\Support;

use Illuminate\Support\Facades\Schema;

/**
 * Whether a column exists, asked once per request. Code that reads a new column must still work
 * on a server where that migration has not run yet (the production server runs this code as soon
 * as it is saved; its migrations run only when approved).
 */
class SchemaCache
{
    /** @var array<string, bool> */
    private static array $known = [];

    public static function hasColumn(string $table, string $column): bool
    {
        return self::$known["{$table}.{$column}"] ??= Schema::hasTable($table) && Schema::hasColumn($table, $column);
    }

    /** for the tests, after a migration ran inside one process */
    public static function forget(): void
    {
        self::$known = [];
    }
}
