import { createContext, useContext } from 'react';
export const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
export const ConfigCtx = createContext({ features: {}, configured: true, missing_config: [] });
export const useConfig = () => useContext(ConfigCtx);
