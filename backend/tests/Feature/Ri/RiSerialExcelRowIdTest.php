<?php

namespace Tests\Feature\Ri;

use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Tests\TestCase;

/** The serial Excel: every row has a hidden, signed Row ID, so moved / sorted rows still land on their own unit. */
class RiSerialExcelRowIdTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function template(): string
    {
        $file = $this->postJson('/api/ri/serials/template', ['name' => 'PO-1', 'lines' => [
            ['key' => 7, 'kode' => 'REG.01', 'deskripsi' => 'Regulator', 'satuan' => 'PCS', 'qty' => 3],
            ['key' => 9, 'kode' => 'POM.01', 'deskripsi' => 'Pompa', 'satuan' => 'PCS', 'qty' => 2],
        ]])->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'ri').'.xlsx';
        file_put_contents($path, $file->streamedContent());

        return $path;
    }

    /** rows 2..6 of the sheet as [cells A..H] */
    private function rows(Worksheet $s): array
    {
        return array_map(fn ($r) => array_map(fn ($c) => $s->getCell($c.$r)->getValue(), range('A', 'H')), range(2, 6));
    }

    private function write(Worksheet $s, array $rows): void
    {
        foreach ($rows as $i => $cells) {
            foreach (range('A', 'H') as $j => $c) {
                $s->setCellValueExplicit($c.($i + 2), (string) ($cells[$j] ?? ''), DataType::TYPE_STRING);
            }
        }
    }

    private function import(string $path)
    {
        return $this->post('/api/ri/serials/import', ['file' => new UploadedFile($path, 'serial.xlsx', null, null, true)], ['Accept' => 'application/json']);
    }

    public function test_rows_keep_their_unit_when_moved_and_the_id_columns_are_hidden(): void
    {
        $this->actingAsRole('super_admin');
        $path = $this->template();
        $book = IOFactory::load($path);
        $s = $book->getActiveSheet();
        $this->assertSame('Row ID', $s->getCell('H1')->getValue());
        $this->assertFalse($s->getColumnDimension('A')->getVisible(), 'Line ID hidden');
        $this->assertFalse($s->getColumnDimension('H')->getVisible(), 'Row ID hidden');
        $this->assertTrue($s->getColumnDimension('G')->getVisible());

        // fill each unit's serial, then sort the rows backwards (and mix the lines) before importing
        $rows = $this->rows($s);
        foreach ($rows as $i => &$cells) {
            $cells[6] = "{$cells[2]}-U{$cells[5]}";
        }
        unset($cells);
        $this->write($s, array_reverse($rows));
        (new Xlsx($book))->save($path);

        $this->import($path)->assertOk()->assertExactJson(['data' => [
            ['key' => 7, 'serials' => ['REG.01-U1', 'REG.01-U2', 'REG.01-U3']],
            ['key' => 9, 'serials' => ['POM.01-U1', 'POM.01-U2']],
        ]]);
    }

    public function test_a_changed_typed_or_copied_row_id_is_refused(): void
    {
        $this->actingAsRole('super_admin');
        $path = $this->template();
        $book = IOFactory::load($path);
        $s = $book->getActiveSheet();
        $rows = $this->rows($s);

        // changed id (another line / unit typed by hand)
        $bad = $rows;
        $bad[0][6] = 'A1';
        $bad[0][7] = '9-1-0000000000';
        $this->write($s, $bad);
        (new Xlsx($book))->save($path);
        $this->assertStringContainsString('tidak valid', $this->import($path)->assertStatus(422)->json('errors.file.0'));

        // a row copied (same id twice)
        $copy = $rows;
        $copy[0][6] = 'A1';
        $copy[1] = $copy[0];
        $copy[1][6] = 'A2';
        $this->write($s, $copy);
        (new Xlsx($book))->save($path);
        $this->assertStringContainsString('ID yang sama', $this->import($path)->assertStatus(422)->json('errors.file.0'));

        // an extra row without an id
        $extra = $rows;
        $extra[0][6] = 'A1';
        $extra[0][7] = '';
        $this->write($s, $extra);
        (new Xlsx($book))->save($path);
        $this->assertStringContainsString('kosong', $this->import($path)->assertStatus(422)->json('errors.file.0'));
    }

    public function test_an_older_file_without_row_id_still_reads_by_line(): void
    {
        $this->actingAsRole('super_admin');
        $book = new \PhpOffice\PhpSpreadsheet\Spreadsheet;
        $s = $book->getActiveSheet();
        foreach (['Line ID', 'No', 'Item Code', 'Item Description', 'Unit', 'Unit No', 'Serial No'] as $i => $h) {
            $s->setCellValue([$i + 1, 1], $h);
        }
        $s->fromArray([[7, 1, 'REG.01', 'R', 'PCS', 1, 'X1'], [7, 2, 'REG.01', 'R', 'PCS', 2, 'X2']], null, 'A2');
        $path = tempnam(sys_get_temp_dir(), 'ri').'.xlsx';
        (new Xlsx($book))->save($path);
        $this->import($path)->assertOk()->assertExactJson(['data' => [['key' => 7, 'serials' => ['X1', 'X2']]]]);
    }
}
