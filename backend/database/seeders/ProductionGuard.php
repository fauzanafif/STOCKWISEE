<?php

namespace Database\Seeders;

use RuntimeException;

/**
 * Seeders overwrite or wipe data (DemoSeeder truncates ~50 transaction tables, UserSeeder
 * resets passwords, RbacSeeder resets role permissions). On 09-11-2026 a DemoSeeder run
 * emptied the production database, so every seeder refuses to run in production.
 */
final class ProductionGuard
{
    public static function refuse(string $seeder): void
    {
        if (app()->environment('production')) {
            throw new RuntimeException(class_basename($seeder).' ditolak: APP_ENV=production. Seeder menimpa atau menghapus data produksi; jalankan hanya di database uji.');
        }
    }
}
