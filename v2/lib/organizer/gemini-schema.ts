type JsonSchemaNode = {
  readonly type?: string;
  readonly enum?: readonly string[];
  readonly items?: JsonSchemaNode;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly minItems?: number;
  readonly maximum?: number;
  readonly minimum?: number;
  readonly additionalProperties?: boolean;
  readonly anyOf?: readonly JsonSchemaNode[];
};

type GeminiSchemaNode = {
  type: "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY" | "OBJECT";
  nullable?: boolean;
  enum?: string[];
  items?: GeminiSchemaNode;
  properties?: Record<string, GeminiSchemaNode>;
  required?: string[];
  propertyOrdering?: string[];
  minItems?: string;
  maximum?: number;
  minimum?: number;
};

const TYPE_MAP: Record<string, GeminiSchemaNode["type"]> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

function convertNode(node: JsonSchemaNode): GeminiSchemaNode {
  if (node.anyOf) {
    const nullable = node.anyOf.some((branch) => branch.type === "null");
    const branch = node.anyOf.find((branch) => branch.type !== "null");
    if (!branch) throw new Error("Unsupported schema: anyOf without a concrete type");
    return { ...convertNode(branch), nullable };
  }
  if (!node.type || !(node.type in TYPE_MAP)) throw new Error(`Unsupported schema type: ${node.type}`);
  const result: GeminiSchemaNode = { type: TYPE_MAP[node.type] };
  if (node.enum) result.enum = [...node.enum];
  if (node.type === "array" && node.items) result.items = convertNode(node.items);
  if (node.type === "array" && typeof node.minItems === "number") result.minItems = String(node.minItems);
  if (node.type === "object" && node.properties) {
    result.properties = Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, convertNode(value)]));
    result.propertyOrdering = Object.keys(node.properties);
    if (node.required) result.required = [...node.required];
  }
  if (typeof node.minimum === "number") result.minimum = node.minimum;
  if (typeof node.maximum === "number") result.maximum = node.maximum;
  return result;
}

export function toGeminiResponseSchema(schema: JsonSchemaNode): GeminiSchemaNode {
  return convertNode(schema);
}
