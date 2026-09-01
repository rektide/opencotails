export class ProfileUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProfileUsageError";
  }
}

export function optionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) throw new ProfileUsageError(`${option} requires a value`);
  return value;
}
