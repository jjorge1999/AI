# Coding Standards & Clean Code Guidelines

This document outlines the coding standards for this project, heavily inspired by Robert C. Martin's ("Uncle Bob") _Clean Code_ philosophy. Adhering to these principles ensures our codebase remains maintainable, readable, and robust.

## 1. Meaningful Names

- **Intent-Revealing Names**: Names should tell you why it exists, what it does, and how it is used.
  - _Bad_: `d` (elapsed time in days)
  - _Good_: `elapsedTimeInDays`, `daysSinceCreation`
- **Avoid Disinformation**: Do not use words that encode false meanings (e.g., `hp` for bad semantics, `accountList` if it's not a List).
- **Pronounceable Names**: Use names that can be spoken (e.g., `generationTimestamp` vs `genymdhms`).
- **Searchable Names**: Avoid single-letter names or common constants. Use named constants (e.g., `MAX_CLASSES_PER_STUDENT`).
- **Class Names**: Nouns or noun phrases (e.g., `Customer`, `WikiPage`, `Account`, `AddressParser`). Avoid `Manager`, `Processor`, `Data`, or `Info` unless absolutely necessary.
- **Method Names**: Verbs or verb phrases (e.g., `postPayment`, `deletePage`, `save`). Accessors/mutators should follow `get`, `set`, `is`.

## 2. Functions

- **Small**: Functions should be small. Then they should be smaller than that. Aim for functions that fit on a screen (and much less).
- **Do One Thing**: Functions should do one thing. They should do it well. They should do it only.
- **One Level of Abstraction**: Statements within a function should be at the same level of abstraction.
- **Switch Statements**: Hide them deep in a low-level class and never repeat them. Ideally, use polymorphism.
- **Descriptive Names**: Don't be afraid to make a name long. A long descriptive name is better than a short enigmatic name.
- **Function Arguments**:
  - Ideal number of arguments is 0 (niladic).
  - Next best is 1 (monadic).
  - Next best is 2 (dyadic).
  - 3 (triadic) should be avoided where possible.
  - More than 3 requires special justification (consider wrapping arguments in a class/object).
- **No Side Effects**: Functions should not do hidden things (e.g., initializing a session in a function named `checkPassword`).

## 3. Comments

- **Comments Do Not Make Up for Bad Code**: Clear and expressive code with few comments is far superior to cluttered and complex code with lots of comments.
- **Explain Yourself in Code**:
  - _Bad_: `// Check to see if the employee is eligible for full benefits` \
    `if ((employee.flags & HOURLY_FLAG) && (employee.age > 65))`
  - _Good_: `if (employee.isEligibleForFullBenefits())`
- **Good Comments**: Legal comments, informative comments (e.g., Regex patterns), explanation of intent (decisions), warning of consequences, TODO comments.
- **Bad Comments**: Mumbling, redundant comments, misleading comments, mandated comments (javadoc for everything), journal comments (changelogs in files), commented-out code (delete it!).

## 4. Formatting

- **Vertical Formatting**:
  - Files should be relatively small (200-500 lines is a good upper limit, though not hard rule).
  - Related concepts should be kept vertically close.
  - Variable declarations should be close to their usage.
- **Horizontal Formatting**:
  - Keep lines short (prevent scrolling).
  - Use whitespace to associate strongly related things and dissociate weakly related things.

## 5. Objects and Data Structures

- **Data Abstraction**: Hiding implementation is about abstractions. A class does not simply push its variables out through getters and setters. Rather it exposes abstract interfaces that allow its users to manipulate the essence of the data, without having to know its implementation.
- **Data/Object Anti-Symmetry**:
  - _Objects_ hide their data behind abstractions and expose functions that operate on that data.
  - _Data structures_ expose their data and have no meaningful functions.
- **The Law of Demeter**: A module should not know about the innards of the objects it manipulates. Method `f` of class `C` should only call methods of: `C`, objects created by `f`, arguments passed to `f`, instance variables of `C`. Avoid unnecessary strict chaining (Train Wrecks) like `ctxt.getOptions().getScratchDir().getAbsolutePath()`.

## 6. Error Handling

- **Use Exceptions Rather Than Return Codes**: This keeps the calling code clean and separates error handling logic from business logic.
- **Write `Try-Catch-Finally` First**: This defines the scope and expectation of the code.
- **Use Unchecked Exceptions**: Checked exceptions can violate the Open/Close principle.
- **Don't Return Null**: If you return null, you check for null. It proliferates checks. Return an empty object or list instead.
- **Don't Pass Null**: Passing null is worse than returning it.

## 7. Boundaries

- **Using Third-Party Code**: encapsulate third-party APIs (like `Map` or `List`) inside your own classes if you rely on specific subsets of their functionality, or to prevent changes in the library from rippling through your code.
- **Learning Tests**: Write tests to explore and understand third-party code.

## 8. Unit Tests

- **TDD (Test Driven Development)**:
  1.  You may not write production code until you have written a failing unit test.
  2.  You may not write more of a unit test than is sufficient to fail, and not compiling is failing.
  3.  You may not write more production code than is sufficient to pass the currently failing test.
- **clean Tests**: Tests must be clean. Readability is even more important in unit tests than in production code.
- **One Assert per Test**: Ideally, minimize the number of assertions per test concept.
- **F.I.R.S.T.**:
  - **F**ast: Tests should be fast.
  - **I**ndependent: Tests should not depend on each other.
  - **R**epeatable: Tests should be repeatable in any environment.
  - **S**elf-Validating: Tests should have a boolean output (pass/fail).
  - **T**imely: Tests should be written _just before_ the production code.

## 9. Classes

- **Class Organization**: Public static constants, private static variables, private instance variables, public functions, private utilities.
- **Classes Should Be Small**: Measured by _responsibilities_.
- **SRP (Single Responsibility Principle)**: A class or module should have one, and only one, reason to change.
- **Cohesion**: Classes should have a small number of instance variables. Each method of a class should manipulate one or more of those variables. The more variables a method manipulates the more cohesive that method is to its class.

## 10. Smells and Heuristics

- **Comments**: Obsolete constants, improperly implemented interface, lazy code.
- **Environment**: Build requires more than one step. Tests require more than one step.
- **Functions**: Too many arguments, output arguments, flag arguments, dead function.
- **General**:
  - Multiple languages in one source file.
  - Obvious behavior is unimplemented.
  - Incorrect behavior at the boundaries.
  - Overriden safeties.
  - Duplication (DRY).
  - Code at wrong level of abstraction.
  - Base classes depending on their derivatives.
  - Too much information.
  - Dead code.
  - Vertical separation.
  - Inconsistency.
  - Clutter.
  - Artificial coupling.
  - Feature Envy.
  - Selector arguments.
  - Obscured intent.
  - Misplaced responsibility.
  - Inappropriate static.
  - Use explanatory variables.
  - Function names should say what they do.
  - Understand the algorithm.
  - Make logical dependencies physical.
  - Prefer polymorphism to If/Else or Switch/Case.
  - Follow standard conventions.
  - Replace magic numbers with named constants.
  - Be precise.
  - Structure over convention.
  - Encapsulate conditionals.
  - Avoid negative conditionals.
  - Functions should do one thing.
  - Hidden temporal couplings.
  - Don't be arbitrary.
  - Encapsulate boundary conditions.
  - Functions should descend only one level of abstraction.
  - Keep configurable data at high levels.
  - Avoid transitive navigation.

---

_This document is a living guide. As our project evolves, so too should our standards._
