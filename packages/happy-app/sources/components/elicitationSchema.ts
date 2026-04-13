type SchemaChoice = {
    const?: unknown;
    title?: unknown;
    description?: unknown;
};

export interface SchemaProperty {
    type?: string;
    title?: string;
    description?: string;
    default?: unknown;
    enum?: string[];
    oneOf?: SchemaChoice[];
    "x-happy-other"?: boolean;
    "x-happy-secret"?: boolean;
}

export interface ElicitationFieldOption {
    value: string;
    label: string;
    description: string;
}

export interface ElicitationField {
    key: string;
    label: string;
    description: string;
    type: string;
    defaultValue: string;
    required: boolean;
    allowOther: boolean;
    secret: boolean;
    options: ElicitationFieldOption[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeChoice(option: SchemaChoice): ElicitationFieldOption | null {
    const rawValue =
        typeof option.const === "string"
            ? option.const
            : typeof option.title === "string"
              ? option.title
              : null;
    if (!rawValue) {
        return null;
    }

    return {
        value: rawValue,
        label: typeof option.title === "string" ? option.title : rawValue,
        description:
            typeof option.description === "string" ? option.description : "",
    };
}

function extractOptions(property: SchemaProperty): ElicitationFieldOption[] {
    if (Array.isArray(property.oneOf) && property.oneOf.length > 0) {
        return property.oneOf
            .map((option) => normalizeChoice(option))
            .filter(
                (option): option is ElicitationFieldOption => option !== null,
            );
    }

    if (Array.isArray(property.enum) && property.enum.length > 0) {
        return property.enum.map((value) => ({
            value,
            label: value,
            description: "",
        }));
    }

    return [];
}

export function parseElicitationFields(
    requestedSchema?: Record<string, unknown> | null,
): ElicitationField[] {
    if (!isRecord(requestedSchema)) {
        return [];
    }

    const properties = isRecord(requestedSchema.properties)
        ? requestedSchema.properties
        : {};
    const requiredSet = new Set(
        Array.isArray(requestedSchema.required)
            ? requestedSchema.required.filter(
                  (key): key is string => typeof key === "string",
              )
            : [],
    );

    return Object.entries(properties)
        .map(([key, rawProperty]) => {
            if (!isRecord(rawProperty)) {
                return null;
            }

            const property = rawProperty as SchemaProperty;
            return {
                key,
                label:
                    typeof property.title === "string"
                        ? property.title
                        : key,
                description:
                    typeof property.description === "string"
                        ? property.description
                        : "",
                type:
                    typeof property.type === "string"
                        ? property.type
                        : "string",
                defaultValue:
                    property.default == null ? "" : String(property.default),
                required: requiredSet.has(key),
                allowOther: property["x-happy-other"] === true,
                secret: property["x-happy-secret"] === true,
                options: extractOptions(property),
            };
        })
        .filter((field): field is ElicitationField => field !== null);
}

export function coerceElicitationValue(
    property: Pick<SchemaProperty, "type">,
    rawValue: string,
): unknown {
    if (property.type === "number" || property.type === "integer") {
        const num = Number(rawValue);
        return Number.isNaN(num) ? 0 : num;
    }

    if (property.type === "boolean") {
        return rawValue === "true";
    }

    return rawValue;
}
