<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Models\Concerns\HasRolesAndPermissions;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'username', 'email', 'phone', 'position', 'password', 'site_id', 'employee_id', 'is_active'])]
#[Hidden(['password', 'remember_token', 'avatar_path'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRolesAndPermissions, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'last_logout_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
            'avatar_updated_at' => 'datetime',
        ];
    }

    /** The profile photo's URL (signed: an <img> sends no token), or null without one. */
    public function avatarUrl(): ?string
    {
        if (! $this->avatar_path) {
            return null;
        }
        $v = (string) ($this->avatar_updated_at?->timestamp ?? 0);

        return '/api/avatars/'.$this->id.'?v='.$v.'&s='.self::avatarSignature($this->id, $v);
    }

    public static function avatarSignature(int $id, string $version): string
    {
        return substr(hash_hmac('sha256', "avatar|{$id}|{$version}", (string) config('app.key')), 0, 32);
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
