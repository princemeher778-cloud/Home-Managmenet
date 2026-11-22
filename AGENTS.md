# HOMEBASE — Project Development Instructions

## 1. Project purpose
HOMEBASE is a shared household management application for a rented shared house. It helps members transparently manage contributions, common expenses, inventory and cleaning responsibilities.

## 2. Current technology
- React
- TypeScript
- Vite
- npm
- Supabase will be introduced later for authentication, database and storage.
- Vercel will be considered for deployment.

Do not introduce additional frameworks or dependencies without a clear reason and approval.

## 3. Development approach
- Develop one module at a time.
- Understand existing code before modifying it.
- Do not build the entire application in one step.
- Do not modify unrelated modules.
- Prefer simple, maintainable and reusable code.
- Avoid unnecessary abstractions and overengineering.
- Do not add features that have not been approved.

## 4. Financial integrity
- Never silently delete financial records.
- Preserve transaction history and corrections.
- Every change to shared records must be traceable to the person who made it.
- Financial calculations must be accurate and tested.
- Never mark a payment as verified merely because a user returns from a UPI app or uploads a screenshot.

## 5. Shared access
- All authenticated household members should be able to add and edit shared records.
- Changes must be attributable to the responsible member.
- Shared data must remain consistent across accounts.
- Protect the database against unauthorized access.

## 6. User interface
- Mobile-first and responsive.
- Clean, simple and professional.
- Prioritize readability and usability.
- Avoid excessive gradients, animations and decorative effects.
- Use consistent spacing, typography and components.

## 7. Code quality
- Use TypeScript properly.
- Avoid `any` unless genuinely necessary.
- Handle errors and loading states.
- Validate user inputs.
- Keep components manageable.
- Never expose secrets or API keys in frontend code.

## 8. Testing and verification
- Run relevant tests after every module.
- Run TypeScript checks and production builds when appropriate.
- Never claim a feature works without verifying it.
- Report errors honestly.
- Do not hide or suppress errors just to make a build pass.

## 9. Antigravity working rules
Before each implementation:
1. Explain the intended changes.
2. Identify the files that will be affected.
3. Implement only the approved scope.
4. Run relevant checks.
5. Summarize changed files, test results and remaining issues.

## 10. Current stage
The project has only been scaffolded using React + TypeScript + Vite.

Do not implement any application modules yet. Do not install additional packages. Only create `AGENTS.md` and inspect the existing project structure. Report the results.
