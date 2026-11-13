<?php

namespace App\Services\Mrp;

use App\Services\UomConverter;
use Illuminate\Validation\ValidationException;

/**
 * Quantity rules of Manufacturing, in decimal strings (bcmath), never floats.
 * BoM quantities keep 6 decimals; whatever moves stock keeps the stock columns' 2 decimals and is
 * never rounded silently: a quantity that does not fit is refused.
 */
final class MrpQty
{
    public const SCALE = 6;

    public static function dec(mixed $v): string
    {
        return UomConverter::dec($v);
    }

    /** A positive number with at most $decimals decimals, as a normalised string; refused otherwise. */
    public static function positive(mixed $v, string $field, int $decimals, string $label): string
    {
        $s = trim((string) $v);
        if (! preg_match('/^\d+(\.\d+)?$/', $s)) {
            throw ValidationException::withMessages([$field => "{$label} harus berupa angka positif."]);
        }
        $frac = str_contains($s, '.') ? rtrim(explode('.', $s)[1], '0') : '';
        if (strlen($frac) > $decimals) {
            throw ValidationException::withMessages([$field => "{$label} paling banyak {$decimals} angka di belakang koma."]);
        }
        if (bccomp($s, '0', self::SCALE) <= 0) {
            throw ValidationException::withMessages([$field => "{$label} harus lebih dari 0."]);
        }

        return bcadd($s, '0', $decimals);
    }

    public static function mul(mixed $a, mixed $b, int $scale = self::SCALE): string
    {
        return bcmul(self::dec($a), self::dec($b), $scale);
    }

    public static function add(mixed $a, mixed $b, int $scale = self::SCALE): string
    {
        return bcadd(self::dec($a), self::dec($b), $scale);
    }

    public static function sub(mixed $a, mixed $b, int $scale = self::SCALE): string
    {
        return bcsub(self::dec($a), self::dec($b), $scale);
    }

    public static function cmp(mixed $a, mixed $b): int
    {
        return bccomp(self::dec($a), self::dec($b), self::SCALE);
    }

    public static function min(mixed $a, mixed $b): string
    {
        return self::cmp($a, $b) <= 0 ? self::dec($a) : self::dec($b);
    }

    public static function max(mixed $a, mixed $b): string
    {
        return self::cmp($a, $b) >= 0 ? self::dec($a) : self::dec($b);
    }

    /** Up to the next 0.01 (what is held for a requirement like 12.345 is 12.35). */
    public static function ceil2(mixed $v): string
    {
        $v = self::dec($v);
        $t = bcadd($v, '0', 2); // truncates
        if (bccomp($t, $v, self::SCALE) < 0) {
            $t = bcadd($t, '0.01', 2);
        }

        return $t;
    }

    /** Down to 0.01. */
    public static function floor2(mixed $v): string
    {
        return bcadd(self::dec($v), '0', 2);
    }

    /** True when the value has no more than two decimals (fits the stock columns exactly). */
    public static function fitsStock(mixed $v): bool
    {
        $v = self::dec($v);

        return bccomp($v, bcadd($v, '0', 2), 8) === 0;
    }

    /** "12.5" for 12.500000 — for messages and the API. */
    public static function show(mixed $v): string
    {
        $s = self::dec($v);
        if (str_contains($s, '.')) {
            $s = rtrim(rtrim($s, '0'), '.');
        }

        return $s === '' || $s === '-0' ? '0' : $s;
    }

    /** For the JSON answer (display only — every calculation stays in strings). */
    public static function num(mixed $v): float
    {
        return (float) self::dec($v);
    }
}
