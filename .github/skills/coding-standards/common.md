# Common Coding Standards

Applies to all repositories regardless of tech stack.

## Code Style

- Don't change import order
- Don't add comments unless already present (preserve existing)
- Don't add log/metrics/console tracking - engineer handles manually

## Accessibility

- Add labels for interactive elements without visible text (use placeholder value)
- Never add `aria-hidden`
- Ensure proper keyboard navigation
- Focus management for modals/dialogs
- Don't expose accessibility props in component interface - handle internally

## Error Handling

- Handle API errors with user-friendly messages
- Implement appropriate retry mechanisms

## Security

- Prevent XSS, CSRF, injections
- Handle sensitive data appropriately
- Use HTTPS
