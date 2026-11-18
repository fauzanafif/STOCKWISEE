<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A user's own dashboard of widgets (see the custom_dashboards migration). */
class CustomDashboard extends Model
{
    public const PERSONAL = 'PERSONAL';

    public const SHARED = 'SHARED';

    protected $fillable = ['user_id', 'name', 'description', 'icon', 'visibility', 'app_key', 'widgets'];

    protected function casts(): array
    {
        return ['widgets' => 'array'];
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /** Opened by its owner, or by anyone when shared. */
    public function visibleTo(User $user): bool
    {
        return $this->user_id === $user->id || $this->visibility === self::SHARED;
    }

    /** Changed or deleted by its owner (Super Admin too, to clear a shared one left behind). */
    public function editableBy(User $user): bool
    {
        return $this->user_id === $user->id || $user->hasRole('super_admin');
    }
}
