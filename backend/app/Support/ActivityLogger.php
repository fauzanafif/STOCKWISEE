<?php

namespace App\Support;

use App\Models\User;
use App\Models\UserActivityLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * The user activity log. Writing it must never break the request it describes: every failure is swallowed
 * (and noted in the Laravel log).
 */
class ActivityLogger
{
    /** fields never stored, whatever their name's case */
    private const SECRET = ['password', 'password_confirmation', 'current_password', 'token', 'secret', 'signature', 'photo', 'file', 'image', 'avatar'];

    /** background calls of the app itself, not something the user did */
    private const SKIP_ROUTES = [
        'api.login', 'api.logout', 'api.activity.page-view', 'api.preferences.update',
        'api.update-alerts.seen', 'api.notifications.read', 'api.notifications.read-all',
    ];

    public static function record(string $event, ?Request $request, array $data = []): void
    {
        try {
            $user = $data['user'] ?? $request?->user();
            unset($data['user']);
            UserActivityLog::create([
                'user_id' => $user?->id,
                'user_name' => $user instanceof User ? mb_substr((string) $user->name, 0, 120) : ($data['user_name'] ?? null),
                'event' => $event,
                'method' => $request?->method(),
                'path' => $request ? mb_substr('/'.ltrim($request->path(), '/'), 0, 255) : null,
                'route' => $request?->route()?->getName(),
                'ip' => $request?->ip(),
                'user_agent' => $request ? mb_substr((string) $request->userAgent(), 0, 255) : null,
                'created_at' => now(),
                ...array_filter(
                    array_intersect_key($data, array_flip(['module', 'description', 'subject', 'status', 'details', 'path'])),
                    fn ($v) => $v !== null,
                ),
            ]);
        } catch (\Throwable $e) {
            Log::warning('activity log not written: '.$e->getMessage());
        }
    }

    /** A change sent to the API (POST / PUT / PATCH / DELETE): what, on which document, and how it ended. */
    public static function request(Request $request, Response $response): void
    {
        try {
            if (! in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true) || ! $request->user()) {
                return;
            }
            $route = $request->route();
            $name = (string) $route?->getName();
            $token = $request->user()->currentAccessToken();
            $agent = $token instanceof \Laravel\Sanctum\PersonalAccessToken && in_array('agent:sync', (array) $token->abilities, true);
            if (in_array($name, self::SKIP_ROUTES, true) || $agent) {
                return;
            }
            [$module, $action] = self::describe($name, $request);
            $event = match (true) {
                $request->method() === 'DELETE' || Str::endsWith($name, ['.destroy', '.delete']) => 'DELETE',
                Str::endsWith($name, ['.store', '.create']) => 'CREATE',
                in_array($request->method(), ['PUT', 'PATCH'], true) || Str::endsWith($name, ['.update', '.upsert']) => 'UPDATE',
                default => 'ACTION',
            };
            self::record($event, $request, [
                'module' => $module,
                'description' => mb_substr($action, 0, 255),
                'subject' => self::subject($request, $response),
                'status' => $response->getStatusCode(),
                'details' => self::details($request, $response),
            ]);
        } catch (\Throwable $e) {
            Log::warning('activity log not written: '.$e->getMessage());
        }
    }

    /** "api.item-requests.approve" → ["Item Requests", "Approve"] */
    private static function describe(string $name, Request $request): array
    {
        $parts = $name !== '' ? explode('.', Str::after($name, 'api.')) : array_values(array_filter(explode('/', Str::after($request->path(), 'api/')), fn ($p) => ! is_numeric($p)));
        $resource = $parts[0] ?? 'api';
        $verb = count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : strtolower($request->method());
        $action = match ($verb) {
            'store' => 'Create', 'update' => 'Edit', 'destroy' => 'Delete', 'upsert' => 'Save',
            default => Str::ucfirst(str_replace(['-', '_'], ' ', $verb)),
        };

        return [Str::title(str_replace(['-', '_'], ' ', $resource)), $action];
    }

    /** the document touched: its number when the answer or the model has one, else its id */
    private static function subject(Request $request, Response $response): ?string
    {
        $content = (string) $response->getContent();
        if ($content !== '' && strlen($content) < 300000 && str_starts_with(ltrim($content), '{')) {
            $data = json_decode($content, true)['data'] ?? null;
            if (is_array($data)) {
                foreach (['number', 'no_npbg', 'no_ppb', 'no_ri', 'no_po', 'code', 'name', 'title'] as $k) {
                    if (isset($data[$k]) && is_scalar($data[$k]) && $data[$k] !== '') {
                        return mb_substr((string) $data[$k], 0, 160);
                    }
                }
            }
        }
        foreach ($request->route()?->parameters() ?? [] as $key => $value) {
            if ($value instanceof Model) {
                foreach (['number', 'no_npbg', 'no_ppb', 'code', 'name', 'title'] as $k) {
                    if (filled($value->getAttribute($k))) {
                        return mb_substr((string) $value->getAttribute($k), 0, 160);
                    }
                }

                return Str::headline($key).' #'.$value->getKey();
            }
            if (is_scalar($value)) {
                return Str::headline($key).' #'.$value;
            }
        }

        return null;
    }

    /** what was sent (no secrets, no files, long text cut) and, when it failed, why */
    private static function details(Request $request, Response $response): ?array
    {
        $clean = function ($value, int $depth = 0) use (&$clean) {
            if (is_array($value)) {
                if ($depth > 3) {
                    return '…';
                }
                $out = [];
                foreach (array_slice($value, 0, 40, true) as $k => $v) {
                    $out[$k] = is_string($k) && Str::contains(Str::lower($k), self::SECRET) ? '***' : $clean($v, $depth + 1);
                }

                return $out;
            }
            if (is_string($value)) {
                return mb_strlen($value) > 300 ? mb_substr($value, 0, 300).'…' : $value;
            }

            return is_object($value) ? '[file]' : $value;
        };
        $out = [];
        $input = $clean($request->except(array_keys($request->allFiles())));
        if ($input) {
            $out['input'] = $input;
        }
        if ($request->allFiles()) {
            $out['files'] = count($request->allFiles());
        }
        if ($response->getStatusCode() >= 400) {
            $body = json_decode((string) $response->getContent(), true);
            $out['error'] = is_array($body) ? mb_substr((string) ($body['message'] ?? ''), 0, 300) : null;
            if (is_array($body['errors'] ?? null)) {
                $out['errors'] = array_slice(array_map(fn ($m) => is_array($m) ? ($m[0] ?? '') : $m, $body['errors']), 0, 10, true);
            }
        }
        if (! $out) {
            return null;
        }
        $json = json_encode($out);

        return strlen((string) $json) > 6000 ? ['input' => '(terlalu besar, '.strlen((string) $json).' byte)'] + array_diff_key($out, ['input' => 1]) : $out;
    }
}
