<?php

namespace Tests\Unit;

use App\Support\MassDeleteGuard;
use Database\Seeders\DemoSeeder;
use Database\Seeders\ProductionGuard;
use PHPUnit\Framework\TestCase;

class MassDeleteGuardTest extends TestCase
{
    public function test_normal_deletions_are_allowed(): void
    {
        $this->assertTrue(MassDeleteGuard::allows(0, 0));
        $this->assertTrue(MassDeleteGuard::allows(1, 9000));
        $this->assertTrue(MassDeleteGuard::allows(50, 300));   // small batch
        $this->assertTrue(MassDeleteGuard::allows(800, 9000)); // under 10%
    }

    public function test_wiping_everything_or_a_big_share_is_refused(): void
    {
        $this->assertFalse(MassDeleteGuard::allows(30, 30));     // every row would go
        $this->assertFalse(MassDeleteGuard::allows(4500, 9000)); // half of the table
        $this->assertFalse(MassDeleteGuard::allows(60, 300));    // over 50 rows and over 10%
    }

    public function test_seeders_have_the_production_guard(): void
    {
        $this->assertTrue(class_exists(ProductionGuard::class));
        foreach (['DatabaseSeeder', 'DemoSeeder', 'RbacSeeder', 'SiteSeeder', 'TrackingSeeder', 'UserSeeder'] as $seeder) {
            $src = file_get_contents(dirname(__DIR__, 2)."/database/seeders/{$seeder}.php");
            $this->assertStringContainsString('ProductionGuard::refuse(static::class);', $src, $seeder);
        }
        $this->assertNotSame('', DemoSeeder::class);
    }
}
