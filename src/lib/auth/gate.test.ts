import { describe, it, expect } from 'vitest';
import { isPublicPath, evaluateGate, sanitizeNextParam } from './gate';

describe('isPublicPath', () => {
  it('allows exactly the auth pages and root icons', () => {
    for (const p of ['/login', '/register', '/favicon.ico', '/icon.svg', '/apple-icon.png']) {
      expect(isPublicPath(p)).toBe(true);
    }
  });
  it('does NOT prefix-match (login-evil stays protected)', () => {
    for (const p of ['/login-evil', '/loginx', '/login/', '/login/x', '/registered']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
  it('protects every page, the API, and all public/ data files', () => {
    for (const p of [
      '/', '/dashboard', '/strategy', '/strategy-dca-swing', '/admin', '/account',
      '/api/risk-data',
      // public/ data files would leak the product without the gate:
      '/risk_data.json', '/btc_risk_binance.csv', '/btc_risk_complete.csv',
      '/btc_historical.json', '/fan_tau_history.json',
    ]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe('evaluateGate', () => {
  it('allows public paths for anonymous users', () => {
    expect(evaluateGate({ pathname: '/login', isAuthenticated: false, isDocumentRequest: true }))
      .toEqual({ action: 'allow' });
  });
  it('bounces authenticated users off /login and /register to /', () => {
    for (const pathname of ['/login', '/register']) {
      expect(evaluateGate({ pathname, isAuthenticated: true, isDocumentRequest: true }))
        .toEqual({ action: 'redirect', to: '/' });
    }
  });
  it('still serves icons to authenticated users', () => {
    expect(evaluateGate({ pathname: '/favicon.ico', isAuthenticated: true, isDocumentRequest: false }))
      .toEqual({ action: 'allow' });
  });
  it('redirects anonymous document navigations to /login with next param', () => {
    expect(evaluateGate({ pathname: '/dashboard', isAuthenticated: false, isDocumentRequest: true }))
      .toEqual({ action: 'redirect', to: '/login?next=%2Fdashboard' });
    expect(evaluateGate({ pathname: '/', isAuthenticated: false, isDocumentRequest: true }))
      .toEqual({ action: 'redirect', to: '/login' });
  });
  it('denies anonymous non-document requests with JSON (fetch must NOT get login HTML)', () => {
    for (const pathname of ['/api/risk-data', '/risk_data.json', '/btc_risk_binance.csv']) {
      expect(evaluateGate({ pathname, isAuthenticated: false, isDocumentRequest: false }))
        .toEqual({ action: 'deny-json' });
    }
  });
  it('allows everything for authenticated users', () => {
    for (const pathname of ['/', '/dashboard', '/admin', '/api/risk-data', '/risk_data.json']) {
      expect(evaluateGate({ pathname, isAuthenticated: true, isDocumentRequest: true }))
        .toEqual({ action: 'allow' });
    }
  });
});

describe('sanitizeNextParam', () => {
  it('passes plain relative paths', () => {
    expect(sanitizeNextParam('/dashboard')).toBe('/dashboard');
    expect(sanitizeNextParam('/strategy-dca-swing')).toBe('/strategy-dca-swing');
  });
  it('rejects open-redirect vectors', () => {
    expect(sanitizeNextParam('//evil.com')).toBe('/');
    expect(sanitizeNextParam('https://evil.com')).toBe('/');
    expect(sanitizeNextParam('javascript:alert(1)')).toBe('/');
    expect(sanitizeNextParam('/\\evil.com')).toBe('/');
    expect(sanitizeNextParam('')).toBe('/');
    expect(sanitizeNextParam(null)).toBe('/');
    expect(sanitizeNextParam(undefined)).toBe('/');
  });
});
