<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A notice from the Super Admin, shown to every user as a popup on its own schedule. */
class UpdateAlert extends Model
{
    public const TYPES = ['feature', 'warning', 'info'];

    public const MODES = ['once', 'login', 'interval'];

    protected $fillable = ['title', 'message', 'type', 'display_mode', 'interval_minutes', 'starts_at', 'ends_at', 'is_active', 'created_by'];

    protected function casts(): array
    {
        return [
            'interval_minutes' => 'integer',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function views(): HasMany
    {
        return $this->hasMany(UpdateAlertView::class);
    }

    /** From when it counts: never before it was made, so an old "active from" can't reach back. */
    public function opensAt(): CarbonInterface
    {
        return $this->starts_at && $this->starts_at->gt($this->created_at) ? $this->starts_at : $this->created_at;
    }

    /**
     * When this user should next see it (may be in the future), or null when not again.
     *   once      the first time only
     *   login     once per sign-in; an alert made after they signed in waits for their next sign-in
     *   interval  at once, then N minutes after they last closed it
     */
    public function nextShowFor(User $user, ?CarbonInterface $lastSeen): ?CarbonInterface
    {
        $opens = $this->opensAt();
        $login = $user->last_login_at;
        $at = match ($this->display_mode) {
            'once' => $lastSeen ? null : $opens,
            'login' => $login && $login->gte($opens) && (! $lastSeen || $lastSeen->lt($login)) ? $login : null,
            default => $lastSeen && ($next = $lastSeen->copy()->addMinutes($this->interval_minutes))->gt($opens) ? $next : $opens,
        };

        return $at && (! $this->ends_at || $at->lt($this->ends_at)) ? $at : null;
    }

    public function status(): string
    {
        return match (true) {
            ! $this->is_active => 'inactive',
            $this->ends_at && $this->ends_at->isPast() => 'ended',
            $this->starts_at && $this->starts_at->isFuture() => 'scheduled',
            default => 'active',
        };
    }
}
