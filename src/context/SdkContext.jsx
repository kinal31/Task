import { createContext, useContext } from 'react';
import { sdk as defaultSdk } from '../sdkInstance.js';

export const SdkContext = createContext(defaultSdk);

export function SdkProvider({ sdk, children }) {
  return <SdkContext.Provider value={sdk}>{children}</SdkContext.Provider>;
}

export function useSdk() {
  return useContext(SdkContext);
}
