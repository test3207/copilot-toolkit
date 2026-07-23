# TypeScript Coding Standards

Applies to TypeScript repositories. Load after `common.md`.

## TypeScript

- Use TypeScript for type safety
- Define interfaces for props, state, and data structures
- Avoid `any` - use proper types or `unknown`

## React

- Functional components with hooks
- Props interface defined above component
- Unit tests required for new React code
- Implement Error Boundaries for component errors

## Framework Migration (React + Knockout repos)

IF repo has `frameworks: [knockout, react]`:

| Scenario | Technology | UT Required |
| -------- | ---------- | ----------- |
| New code | React (required) | Yes |
| Existing KO code fix | Knockout (allowed) | No |
| Existing KO code refactor | React (preferred) | Yes |

## Accessibility (TSX)

```tsx
// aria-label: placeholder value, engineer will finalize
<Button
  aria-label="Delete item"
  icon={<DeleteIcon />}
  onClick={handleDelete}
/>
```

```tsx
// Don't expose accessibility props in interface
// Good: Handle internally
const MyComponent = ({ label }: IProps) => {
  return <div aria-label="Placeholder">{label}</div>;
};
```

## Automation (E2E Testing)

- Use `data-automation-id` for E2E selectors
- Naming convention: `<prefix>-<bladeShort>-<control>` (e.g., `avd-hp-saveButton`)
- Don't use dynamic content (counts, names, timestamps)
- Ensure uniqueness within each blade
- Don't use `data-testid` for E2E - reserve for unit/integration tests

```tsx
<PrimaryButton
  text="Assign"
  data-automation-id="avd-mi-assignButton"
  onClick={handleClick}
/>
```

## Reference

Full React migration guide: see `reactmigration.md` in repo's `.github/instructions/` (if available).
