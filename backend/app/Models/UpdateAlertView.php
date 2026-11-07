<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** When a user last closed an Update Alert, and when they first gave it a thumbs up. */
class UpdateAlertView extends Model
{
    public $timestamps = false;

    protected $fillable = ['update_alert_id', 'user_id', 'last_seen_at', 'thumbed_up_at'];

    protected function casts(): array
    {
        return ['last_seen_at' => 'datetime', 'thumbed_up_at' => 'datetime'];
    }
}
