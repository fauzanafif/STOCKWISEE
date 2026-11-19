<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DashboardNote extends Model
{
    public const COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange'];

    protected $fillable = ['user_id', 'anchor', 'layout', 'title', 'body', 'checklist', 'color', 'pinned', 'done_at', 'remind_at'];

    protected function casts(): array
    {
        return [
            'checklist' => 'array',
            'layout' => 'array',
            'pinned' => 'boolean',
            'done_at' => 'datetime',
            'remind_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
