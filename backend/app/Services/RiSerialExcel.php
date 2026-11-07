<?php

namespace App\Services;

use App\Support\RiSerials;
use Illuminate\Validation\ValidationException;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\NumberFormat;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** The Excel of an RI's serial numbers: one row per unit. "Line ID" ties a row back to its line. */
class RiSerialExcel
{
    public const MAX_ROWS = 5000;

    private const HEADERS = ['Line ID', 'No', 'Item Code', 'Item Description', 'Unit', 'Unit No', 'Serial No'];

    /** @param  iterable<array{key:int, kode?:?string, deskripsi?:?string, satuan?:?string, qty:int, serials?:?array}>  $lines */
    public function download(iterable $lines, string $filename): StreamedResponse
    {
        $book = new Spreadsheet;
        $sheet = $book->getActiveSheet();
        $sheet->setTitle('Serial No');
        foreach (self::HEADERS as $c => $h) {
            $sheet->setCellValue([$c + 1, 1], $h);
        }
        $sheet->getStyle('A1:G1')->getFont()->setBold(true);
        $sheet->getStyle('A1:G1')->getFill()->setFillType('solid')->getStartColor()->setRGB('F1F5F9');
        $sheet->freezePane('A2');

        $r = 2;
        foreach ($lines as $line) {
            for ($u = 1; $u <= $line['qty']; $u++) {
                $sheet->setCellValue([1, $r], (int) $line['key']);
                $sheet->setCellValue([2, $r], $r - 1);
                // text the browser sent or a vendor wrote is never a formula, and "089001" keeps its zero
                $sheet->setCellValueExplicit([3, $r], (string) ($line['kode'] ?? ''), DataType::TYPE_STRING);
                $sheet->setCellValueExplicit([4, $r], (string) ($line['deskripsi'] ?? ''), DataType::TYPE_STRING);
                $sheet->setCellValueExplicit([5, $r], (string) ($line['satuan'] ?? ''), DataType::TYPE_STRING);
                $sheet->setCellValue([6, $r], $u);
                $sheet->setCellValueExplicit([7, $r], (string) ($line['serials'][$u - 1] ?? ''), DataType::TYPE_STRING);
                $r++;
            }
        }
        if ($r > 2) {
            $sheet->getStyle('G2:G'.($r - 1))->getNumberFormat()->setFormatCode(NumberFormat::FORMAT_TEXT);
            $sheet->getStyle('G2:G'.($r - 1))->getFill()->setFillType('solid')->getStartColor()->setRGB('FEF9C3');
        }
        foreach (['A' => 9, 'B' => 6, 'C' => 16, 'D' => 48, 'E' => 8, 'F' => 8, 'G' => 32] as $col => $width) {
            $sheet->getColumnDimension($col)->setWidth($width);
        }

        return response()->streamDownload(function () use ($book) {
            (new Xlsx($book))->save('php://output');
        }, $filename, ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    }

    /** @return list<array{key:int, serials:list<string>}> per line, in the order they first appear */
    public function parse(string $path): array
    {
        try {
            $reader = IOFactory::createReaderForFile($path);
            $reader->setReadDataOnly(true);
            $sheet = $reader->load($path)->getActiveSheet();
        } catch (\Throwable) {
            throw ValidationException::withMessages(['file' => 'File Excel tidak bisa dibaca.']);
        }

        $last = $sheet->getHighestDataRow();
        if ($last - 1 > self::MAX_ROWS) {
            throw ValidationException::withMessages(['file' => 'Maksimal '.self::MAX_ROWS.' baris nomor seri per file.']);
        }
        $head = [];
        foreach (range(1, min(20, \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($sheet->getHighestDataColumn()))) as $c) {
            $head[mb_strtolower(trim((string) $sheet->getCell([$c, 1])->getValue()))] = $c;
        }
        $keyCol = $head['line id'] ?? null;
        $serialCol = $head['serial no'] ?? null;
        if (! $keyCol || ! $serialCol) {
            throw ValidationException::withMessages(['file' => 'Format file tidak dikenali. Pakai file dari tombol Export.']);
        }

        $lines = [];
        $firstRow = [];
        for ($r = 2; $r <= $last; $r++) {
            $serial = $this->text($sheet->getCell([$serialCol, $r])->getValue());
            if ($serial === '') {
                continue;
            }
            $key = $sheet->getCell([$keyCol, $r])->getValue();
            if (! is_numeric($key)) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: Line ID kosong atau berubah. Pakai file dari tombol Export."]);
            }
            if (str_contains($serial, ';')) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: nomor seri tidak boleh berisi tanda titik koma."]);
            }
            if (mb_strlen($serial) > 100) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: nomor seri lebih dari 100 karakter."]);
            }
            $id = (int) $key;
            $at = mb_strtolower($serial);
            if (isset($firstRow[$id][$at])) {
                throw ValidationException::withMessages(['file' => "Nomor seri {$serial} dobel: baris {$firstRow[$id][$at]} dan {$r}."]);
            }
            $firstRow[$id][$at] = $r;
            $lines[$id][] = $serial;
        }
        if ($lines === []) {
            throw ValidationException::withMessages(['file' => 'Belum ada nomor seri yang diisi di file ini.']);
        }

        return array_map(fn ($id) => ['key' => $id, 'serials' => $lines[$id]], array_keys($lines));
    }

    /** A cell as a serial; a number Excel stored as a number comes back without ".0" or an exponent. */
    private function text(mixed $value): string
    {
        if (is_float($value)) {
            return floor($value) === $value ? number_format($value, 0, '', '') : rtrim(rtrim(sprintf('%.6F', $value), '0'), '.');
        }
        if ($value instanceof \PhpOffice\PhpSpreadsheet\RichText\RichText) {
            return trim($value->getPlainText());
        }

        return trim((string) $value);
    }
}
