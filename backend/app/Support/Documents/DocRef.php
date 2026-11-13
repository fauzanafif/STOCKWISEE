<?php

namespace App\Support\Documents;

/**
 * One transaction document as Chatter / Activity / Audit / Smart Buttons see it: its type, its key (the id, or the
 * document number for documents kept one row per item line) and the id its page opens with.
 */
final class DocRef
{
    public function __construct(
        public readonly string $type,
        public readonly string $key,
        public readonly int $id,
        public readonly string $number,
        public readonly ?int $ownerId = null, // the requester of an Item Request
    ) {}

    public function toArray(): array
    {
        return ['type' => $this->type, 'key' => $this->key, 'id' => $this->id, 'number' => $this->number, 'label' => DocumentRegistry::label($this->type)];
    }
}
