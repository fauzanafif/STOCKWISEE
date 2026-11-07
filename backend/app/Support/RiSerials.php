<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

/**
 * Serial numbers of an RI line, kept in ri.no_seri the way Accurate's SNLine holds them:
 * "A1 ; A2 ; A3", one per unit. A serial is whatever the goods carry: a number, or a range for a pack.
 */
final class RiSerials
{
    public const SEPARATOR = ' ; ';

    /** @return list<string> */
    public static function split(?string $text): array
    {
        return array_values(array_filter(array_map('trim', explode(';', (string) $text)), fn ($s) => $s !== ''));
    }

    public static function join(array $serials): string
    {
        return implode(self::SEPARATOR, $serials);
    }

    /** For a printed cell one row high: the first serial and how many more. */
    public static function summary(?string $text): ?string
    {
        $list = self::split($text);
        if (count($list) < 2) {
            return $text;
        }

        return $list[0].' +'.(count($list) - 1);
    }

    /**
     * What was typed or imported for a line: blanks dropped, then all or nothing, one serial per unit.
     *
     * @return list<string>
     */
    public static function clean(?array $serials, float $qty, string $item): array
    {
        $list = array_values(array_filter(array_map(fn ($s) => trim((string) $s), $serials ?? []), fn ($s) => $s !== ''));
        if ($list === []) {
            return [];
        }
        if (floor($qty) !== $qty) {
            throw ValidationException::withMessages(['serials' => "{$item}: nomor seri per unit hanya untuk jumlah bulat (sekarang {$qty})."]);
        }
        if (count($list) !== (int) $qty) {
            throw ValidationException::withMessages(['serials' => "{$item}: diterima ".(int) $qty.' unit tetapi nomor serinya '.count($list).'.']);
        }
        foreach ($list as $s) {
            if (str_contains($s, ';')) {
                throw ValidationException::withMessages(['serials' => "{$item}: nomor seri tidak boleh berisi tanda titik koma ({$s})."]);
            }
        }
        if ($twice = self::firstRepeated($list)) {
            throw ValidationException::withMessages(['serials' => "{$item}: nomor seri {$twice} ditulis lebih dari sekali."]);
        }

        return $list;
    }

    public static function firstRepeated(array $list): ?string
    {
        $seen = [];
        foreach ($list as $s) {
            $key = mb_strtolower($s);
            if (isset($seen[$key])) {
                return $s;
            }
            $seen[$key] = true;
        }

        return null;
    }
}
