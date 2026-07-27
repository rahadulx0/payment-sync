import type { KeyType } from '@paysync/shared';

export interface CompanyContext {
  companyId: string;
  companyCode: string;
  scopes: string[];
  keyType?: KeyType;
}

export interface DeviceContext {
  deviceId: string;
  installId: string;
}

export interface AdminContext {
  adminId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authCompany?: CompanyContext;
      authDevice?: DeviceContext;
      authAdmin?: AdminContext;
    }
  }
}
