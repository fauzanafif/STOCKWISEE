<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserActivityLog extends Model
{
    public const UPDATED_AT = null;

    public const EVENTS = ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PAGE_VIEW', 'CREATE', 'UPDATE', 'DELETE', 'ACTION'];

    protected $fillable = ['user_id', 'user_name', 'event', 'module', 'description', 'subject', 'method', 'path', 'route', 'status', 'ip', 'user_agent', 'details', 'created_at'];

    protected function casts(): array
    {
        return ['details' => 'array', 'created_at' => 'datetime'];
    }
}
