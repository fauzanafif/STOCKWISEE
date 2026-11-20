<?php

namespace App\Http\Requests\Item;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:40', Rule::unique('items', 'code')],
            'description' => ['required', 'string', 'max:400'],
            'category_id' => ['nullable', 'integer', Rule::exists('categories', 'id')],
            'unit_id' => ['nullable', 'integer', Rule::exists('units', 'id'), // UOM: one its category allows (Master UOM › Parent Category; none set: the fixed list ItemOptions::UOM)
                \App\Services\Uom\CategoryUomRules::itemUnitRule($this, null)],
            'item_type' => ['sometimes', Rule::in(['CONSUMABLE', 'SERIALIZED', 'ASSET_PART', 'TYRE', 'MANUFACTURED'])],
            'product_kind' => ['sometimes', Rule::in(['BARANG', 'JASA'])],
            'needs_blueprint' => ['sometimes', 'boolean'],
            'lead_time_days' => ['nullable', 'integer', 'min:0', 'max:3650'],
            'default_warehouse_id' => ['nullable', 'integer', Rule::exists('warehouses', 'id')],
            'default_location_id' => ['nullable', 'integer', Rule::exists('warehouse_locations', 'id')],
            'blueprint_img_path' => ['nullable', 'string', 'max:255'],
            'blueprint_3d_ref' => ['nullable', 'string', 'max:60'],
            'is_active' => ['sometimes', 'boolean'],
        ] + \App\Support\ItemOptions::rules();
    }
}
