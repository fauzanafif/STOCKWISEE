<?php

namespace App\Support\Documents;

use App\Models\DocAuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Throwable;

/**
 * Audit Trail of the transaction documents: an Eloquent observer that writes what a signed-in user changed
 * (before → after) to doc_audit_logs. It only watches, it never changes the save it sees, and a failure to log
 * never stops the business step.
 *
 * Not logged: anything without a signed-in user (console, scheduler, queue, the Accurate agent), the Accurate
 * sync routes, and housekeeping columns (timestamps, tokens, photos, signatures).
 */
final class DocumentAudit
{
    /** model class => [doc type, how to get the document key from the row] */
    private const MODELS = [
        \App\Models\ItemRequest::class => ['item_request', 'id'],
        \App\Models\ItemRequestLine::class => ['item_request', 'item_request_id'],
        \App\Models\ItemRequestFulfillment::class => ['item_request', 'item_request_id'],
        \App\Models\Npbg::class => ['delivery_order', 'no_npbg'],
        \App\Models\PpbDraft::class => ['ppb_draft', 'id'],
        \App\Models\PpbDraftLine::class => ['ppb_draft', 'ppb_draft_id'],
        \App\Models\Ppb::class => ['purchase_request', 'no_ppb'],
        \App\Models\PurchaseOrder::class => ['purchase_order', 'id'],
        \App\Models\PurchaseOrderItem::class => ['purchase_order', 'purchase_order_id'],
        \App\Models\Ri::class => ['receipt', 'no_ri'],
        \App\Models\PurchaseReturn::class => ['purchase_return', 'id'],
        \App\Models\PurchaseReturnLine::class => ['purchase_return', 'purchase_return_id'],
    ];

    /** never logged: noise or secrets */
    private const SKIP = ['id', 'created_at', 'updated_at', 'remember_token', 'password', 'track_token', 'token', 'signature', 'photo'];

    /** route names whose writes are the Accurate mirror, not a user's decision */
    private const SKIP_ROUTES = ['api.agent.', 'api.sync.'];

    public static function register(): void
    {
        foreach (array_keys(self::MODELS) as $class) {
            if (class_exists($class)) {
                $class::observe(self::class);
            }
        }
    }

    public function created(Model $model): void
    {
        $this->write($model, 'CREATED', collect($model->getAttributes())->except(self::SKIP)
            ->reject(fn ($v, $k) => $this->skipColumn($k) || $v === null || $v === '')->map(fn ($v) => [null, $this->value($v)])->all());
    }

    public function updated(Model $model): void
    {
        $changes = [];
        foreach ($model->getChanges() as $field => $after) {
            if (in_array($field, self::SKIP, true) || $this->skipColumn($field)) {
                continue;
            }
            $before = $model->getOriginal($field);
            if ((string) $this->value($before) === (string) $this->value($after)) {
                continue;
            }
            $changes[$field] = [$this->value($before), $this->value($after)];
        }
        if ($changes !== []) {
            $this->write($model, 'UPDATED', $changes);
        }
    }

    public function deleted(Model $model): void
    {
        $this->write($model, 'DELETED', collect($model->getAttributes())->except(self::SKIP)
            ->reject(fn ($v, $k) => $this->skipColumn($k) || $v === null || $v === '')->map(fn ($v) => [$this->value($v), null])->all());
    }

    /** A Chatter / Activity event of a user on a document (edited message, deleted message, activity done …). */
    public static function event(DocRef $doc, string $event, string $model, ?int $modelId, array $changes = [], ?string $reason = null): void
    {
        self::store($doc->type, $doc->key, $model, $modelId, $event, $changes, $reason);
    }

    private function write(Model $model, string $event, array $changes): void
    {
        [$type, $keyColumn] = self::MODELS[$model::class] ?? [null, null];
        if (! $type || ! $this->active()) {
            return;
        }
        $key = $model->getAttribute($keyColumn) ?? $model->getOriginal($keyColumn);
        if ($key === null || $key === '') {
            $key = "#{$model->getKey()}"; // a line without a document number yet (same key DocumentRegistry gives it)
        }
        $reason = request()?->input('reason') ?? request()?->input('cancel_reason') ?? request()?->input('note');
        self::store($type, (string) $key, class_basename($model), $model->getKey(), $event, $changes, is_string($reason) ? $reason : null);
    }

    private static function store(string $type, string $key, string $model, ?int $modelId, string $event, array $changes, ?string $reason): void
    {
        try {
            $user = Auth::user();
            $request = request();
            DocAuditLog::create([
                'res_type' => $type, 'res_key' => mb_substr($key, 0, 80), 'model' => $model, 'model_id' => $modelId, 'event' => $event,
                'changes' => $changes ?: null, 'reason' => $reason !== null ? mb_substr(trim($reason), 0, 500) ?: null : null,
                'user_id' => $user?->id, 'user_name' => $user?->name,
                'route' => $request?->route()?->getName(), 'ip' => $request?->ip(), 'created_at' => now(),
            ]);
        } catch (Throwable $e) {
            report($e); // never stop the business step because of the log
        }
    }

    /** Only a signed-in user's own action, never the Accurate mirror. */
    private function active(): bool
    {
        if (! Auth::check()) {
            return false;
        }
        $route = request()?->route()?->getName() ?? '';

        return ! Str::startsWith($route, self::SKIP_ROUTES);
    }

    private function skipColumn(string $column): bool
    {
        return Str::contains($column, ['token', 'password', 'signature', 'photo', 'img', 'image', '_path']) || Str::startsWith($column, 'accurate_');
    }

    private function value(mixed $v): mixed
    {
        if ($v instanceof \DateTimeInterface) {
            return $v->format('Y-m-d H:i:s');
        }
        if (is_array($v) || is_object($v)) {
            $v = json_encode($v, JSON_UNESCAPED_UNICODE);
        }
        if (is_string($v) && mb_strlen($v) > 300) {
            return mb_substr($v, 0, 300).'…';
        }
        if (is_numeric($v) && is_string($v)) {
            return str_contains($v, '.') ? rtrim(rtrim($v, '0'), '.') : $v;
        }

        return $v;
    }
}
