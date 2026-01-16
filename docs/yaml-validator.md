# YAML Validator for Policy Generation

## Summary

Add comprehensive YAML validation to the Generate with AI page that catches errors before users attempt to deploy policies. This addresses the issue where AI-generated policies may have syntax or structural errors that only surface during deployment.

## Problem Statement

When generating policies with AI, the LLM may produce YAML with:
1. **Syntax errors** - Incorrect indentation, missing colons, invalid characters
2. **Structural errors** - Fields that should be arrays rendered as objects, missing required fields
3. **Type-specific errors** - Wrong apiVersion, invalid kind, malformed selectors

Currently, these errors are only discovered when the operator tries to deploy the policy, leading to a poor user experience with the deploy → fail → fix cycle.

## Solution

Implement a two-layer validation system:

### Layer 1: YAML Syntax Validation
- Parse YAML using `js-yaml` library
- Catch and display parsing errors with line numbers
- Detect common issues like incorrect indentation

### Layer 2: Schema Validation
- Validate against policy type schemas (CiliumNetworkPolicy, TracingPolicy, Gateway API)
- Check required fields exist
- Verify field types (arrays vs objects, strings vs numbers)
- Validate apiVersion and kind match the selected policy type

## Implementation Plan

### Phase 1: Create Unified Policy Validator

**New file:** `src/lib/policy-validator.ts`

```typescript
// Core validation function
export function validatePolicy(
  yamlContent: string,
  policyType: PolicyType
): ValidationResult {
  // Layer 1: YAML syntax
  const parseResult = parseYamlSafely(yamlContent);
  if (!parseResult.success) {
    return { valid: false, errors: [parseResult.error] };
  }

  // Layer 2: Schema validation
  const schemaErrors = validatePolicySchema(parseResult.data, policyType);
  if (schemaErrors.length > 0) {
    return { valid: false, errors: schemaErrors };
  }

  return { valid: true, errors: [], parsed: parseResult.data };
}

// Types
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  parsed?: Record<string, unknown>;
}

export interface ValidationError {
  type: 'syntax' | 'schema' | 'field';
  message: string;
  line?: number;
  field?: string;
}
```

**Schema validation rules by policy type:**

| Policy Type | apiVersion | Kind | Required Fields |
|-------------|------------|------|-----------------|
| CILIUM_NETWORK | cilium.io/v2 | CiliumNetworkPolicy | metadata.name, metadata.namespace, spec |
| CILIUM_CLUSTERWIDE | cilium.io/v2 | CiliumClusterwideNetworkPolicy | metadata.name, spec |
| TETRAGON | cilium.io/v1alpha1 | TracingPolicy or TracingPolicyNamespaced | metadata.name, spec |
| GATEWAY_HTTPROUTE | gateway.networking.k8s.io/v1 | HTTPRoute | metadata.name, spec.parentRefs |
| GATEWAY_GRPCROUTE | gateway.networking.k8s.io/v1alpha2 | GRPCRoute | metadata.name, spec.parentRefs |
| GATEWAY_TCPROUTE | gateway.networking.k8s.io/v1alpha2 | TCPRoute | metadata.name, spec.parentRefs |
| GATEWAY_TLSROUTE | gateway.networking.k8s.io/v1alpha2 | TLSRoute | metadata.name, spec.parentRefs |

**Cilium-specific validation:**
- `spec.endpointSelector` must be object (not array)
- `spec.ingress` and `spec.egress` must be arrays
- `spec.ingress[].fromEndpoints` must be array
- `spec.egress[].toEndpoints` must be array
- `spec.egress[].toFQDNs` must be array (common AI error)
- `spec.egress[].toPorts` must be array

**Tetragon-specific validation:**
- `spec.kprobes` must be array
- `spec.kprobes[].selectors` must be array
- `spec.kprobes[].selectors[].matchArgs` must be array
- `spec.kprobes[].selectors[].matchActions` must be array

### Phase 2: Integrate into Generate Page

**Update:** `src/app/policies/generate/page.tsx`

Add validation on YAML change:
```typescript
const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

// Validate whenever generated YAML changes
useEffect(() => {
  if (generatedYaml && selectedType) {
    const result = validatePolicy(generatedYaml, selectedType);
    setValidationResult(result);
  }
}, [generatedYaml, selectedType]);
```

Add validation UI below YAML display:
```tsx
{validationResult && !validationResult.valid && (
  <div className="mt-4 p-4 bg-danger/10 border border-danger/30 rounded-lg">
    <h4 className="font-semibold text-danger mb-2">Validation Errors</h4>
    <ul className="space-y-1 text-sm text-danger">
      {validationResult.errors.map((err, i) => (
        <li key={i}>
          {err.line && <span className="font-mono">Line {err.line}: </span>}
          {err.field && <span className="font-mono">{err.field}: </span>}
          {err.message}
        </li>
      ))}
    </ul>
  </div>
)}

{validationResult?.valid && (
  <div className="mt-4 p-3 bg-success/10 border border-success/30 rounded-lg">
    <span className="text-success">✓ YAML is valid</span>
  </div>
)}
```

Disable save button when invalid:
```tsx
<Button
  onClick={handleSavePolicy}
  disabled={!validationResult?.valid}
>
  Save Policy
</Button>
```

### Phase 3: Add Validation Tests

**New file:** `src/lib/__tests__/policy-validator.test.ts`

Test cases:
1. Valid YAML for each policy type
2. YAML syntax errors (indentation, missing colons)
3. Wrong apiVersion for policy type
4. Wrong kind for policy type
5. Missing required fields
6. Arrays rendered as objects (toFQDNs issue)
7. Objects rendered as arrays

### Phase 4: Server-Side Validation

**Update:** `src/server/routers/policy.ts`

Add validation in create mutation:
```typescript
create: protectedProcedure
  .input(createPolicySchema)
  .mutation(async ({ ctx, input }) => {
    // Validate policy content
    const validation = validatePolicy(input.content, input.type);
    if (!validation.valid) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid policy YAML: ${validation.errors[0].message}`,
      });
    }
    // ... rest of create logic
  }),
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/policy-validator.ts` | Core validation logic |
| `src/lib/__tests__/policy-validator.test.ts` | Validation tests |

## Files to Modify

| File | Changes |
|------|---------|
| `src/app/policies/generate/page.tsx` | Add validation UI and logic |
| `src/server/routers/policy.ts` | Add server-side validation |

## Verification

1. **Unit tests**: Run `npm run test` and verify all policy-validator tests pass
2. **Manual testing**:
   - Generate a Cilium policy with AI
   - Intentionally break indentation, verify error shown
   - Fix error, verify "valid" indicator shown
   - Try to save invalid policy, verify button disabled
3. **Integration**:
   - Generate valid policy, save, deploy
   - Verify deployment succeeds (no operator errors)

## Error Messages

Clear, actionable error messages:

| Error Type | Example Message |
|------------|-----------------|
| YAML syntax | `Invalid YAML syntax at line 15: mapping values are not allowed in this context` |
| Wrong kind | `Expected kind 'CiliumNetworkPolicy' for policy type CILIUM_NETWORK, got 'TracingPolicy'` |
| Missing field | `Missing required field: metadata.name` |
| Wrong type | `Field 'spec.egress[0].toFQDNs' must be an array, got object` |
| Wrong apiVersion | `Expected apiVersion 'cilium.io/v2' for CiliumNetworkPolicy, got 'cilium.io/v1'` |

## Future Enhancements

1. **JSON Schema validation**: Use official CRD JSON schemas for complete validation
2. **Auto-fix suggestions**: Suggest fixes for common errors
3. **Real-time validation**: Validate as user edits (with debounce)
4. **Policy linting**: Warn about best practice violations (e.g., overly permissive rules)
