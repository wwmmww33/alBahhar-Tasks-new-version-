const toId = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export const firstId = (...values: unknown[]): string => {
  for (const value of values) {
    const id = toId(value);
    if (id) return id;
  }
  return '';
};

type ActorLike = {
  CurrentVacancyID?: unknown;
  ActiveVacancyID?: unknown;
  VacancyID?: unknown;
  UserID?: unknown;
};

export const resolveCurrentActorId = (user?: ActorLike | null): string => {
  return firstId(user?.CurrentVacancyID, user?.ActiveVacancyID, user?.VacancyID, user?.UserID);
};

export const resolveUserActorId = (user?: ActorLike | null): string => {
  return firstId(user?.CurrentVacancyID, user?.ActiveVacancyID, user?.VacancyID, user?.UserID);
};

export const resolveDelegatorActorId = (delegation: any): string => {
  return firstId(delegation?.DelegatorVacancyID, delegation?.DelegatorID);
};

export const resolveDelegateActorId = (delegation: any): string => {
  return firstId(delegation?.DelegateVacancyID, delegation?.DelegateID);
};
