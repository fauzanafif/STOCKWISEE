<?php

namespace App\Services\Mrp;

use App\Models\MrpActivity;
use App\Models\MrpBom;
use App\Models\MrpProduction;
use App\Models\User;

/** Writes the document history of a BoM / MO (mrp_activities). */
final class MrpLog
{
    public static function write(MrpBom|MrpProduction $subject, string $action, ?User $user, ?string $from = null, ?string $to = null, ?string $note = null): void
    {
        MrpActivity::create([
            'subject_type' => $subject instanceof MrpBom ? 'BOM' : 'MO',
            'subject_id' => $subject->id,
            'action' => $action,
            'from_status' => $from,
            'to_status' => $to,
            'note' => $note,
            'user_id' => $user?->id,
            'created_at' => now(),
        ]);
    }
}
