/**
 * 画面の切り替え（10.2）。
 *
 * ロック中は dashboard 系の画面へ入れない。状態から機械的に決めることで、
 * 「ロック中なのに文書情報が見える」経路を作らないようにする。
 */

import { Dashboard } from '../components/Dashboard';
import { DocumentViewerScreen } from '../components/DocumentViewerScreen';
import { ErrorScreen } from '../components/ErrorScreen';
import { LockScreen } from '../components/LockScreen';
import { PushRegistrationScreen } from '../components/PushRegistrationScreen';
import { SettingsScreen } from '../components/SettingsScreen';
import { SetupWizard } from '../components/SetupWizard';
import { StartupScreen } from '../components/StartupScreen';
import { AppProvider, useApp } from './AppProvider';

function CurrentScreen(): React.JSX.Element {
  const { state } = useApp();

  // ロック中に到達できる画面を限定する（FR-AUTH-004）。
  const locked = state.vault === null;

  switch (state.screen) {
    case 'startup':
      return <StartupScreen />;
    case 'setup':
      return <SetupWizard />;
    case 'lock':
      return <LockScreen />;
    case 'dashboard':
      return locked ? <LockScreen /> : <Dashboard />;
    case 'viewer':
      return locked ? <LockScreen /> : <DocumentViewerScreen />;
    case 'settings':
      return locked ? <LockScreen /> : <SettingsScreen />;
    case 'push':
      return locked ? <LockScreen /> : <PushRegistrationScreen />;
    case 'error':
      return <ErrorScreen />;
    default:
      return <StartupScreen />;
  }
}

export function App(): React.JSX.Element {
  return (
    <AppProvider>
      <CurrentScreen />
    </AppProvider>
  );
}
