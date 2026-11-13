<?php

namespace App\Support;

/**
 * Last line of defence for "delete what is no longer in Accurate" steps: a partial or empty
 * fetch must never be read as a mass deletion in Accurate.
 */
final class MassDeleteGuard
{
    /** Above this many rows a deletion must also stay under MAX_SHARE of the existing rows. */
    public const MAX_ROWS = 50;

    public const MAX_SHARE = 0.10;

    /** True when removing $toDelete of $existing rows looks like a normal change, not a broken fetch. */
    public static function allows(int $toDelete, int $existing): bool
    {
        if ($toDelete <= 0) {
            return true;
        }
        if ($existing > 0 && $toDelete >= $existing) {
            return false; // everything would go
        }

        return $toDelete <= self::MAX_ROWS || $toDelete <= $existing * self::MAX_SHARE;
    }
}
