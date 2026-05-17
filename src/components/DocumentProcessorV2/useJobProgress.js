// DP-4 · підписка на jobProgressStore (DP-3) для повноекранного прогресу.
// Стільниковий принцип: доменний прогрес — з transient-стора (не App SSOT),
// тут лише локальний UI-стан підписки.
import { useEffect, useState } from 'react';
import { subscribe } from '../../services/documentPipeline/jobProgressStore.js';

// Повертає масив активних jobs (snapshot стора). Фільтр по caseId — у caller.
export function useJobProgress() {
  const [jobs, setJobs] = useState([]);
  useEffect(() => subscribe(setJobs), []);
  return jobs;
}
