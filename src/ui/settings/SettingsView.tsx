import type { SettingsSection } from '../../engine/types.ts';
import { Icon, type IconName } from '../common/Icon.tsx';
import { dispatch, useEngine } from '../hooks.ts';
import { About } from './About.tsx';
import { AudioCheck } from './AudioCheck.tsx';
import { ControllerSettings } from './ControllerSettings.tsx';
import { Preferences } from './Preferences.tsx';

const SECTIONS: { id: SettingsSection; label: string; icon: IconName }[] = [
  { id: 'controller', label: 'Controller', icon: 'midi' },
  { id: 'audio', label: 'Audio', icon: 'speaker' },
  { id: 'preferences', label: 'Preferences', icon: 'sliders' },
  { id: 'about', label: 'About', icon: 'info' },
];

export function SettingsView() {
  const section = useEngine((s) => s.ui.settingsSection);
  return (
    <div className="view settings">
      <nav className="panel side-nav" aria-label="Settings">
        {SECTIONS.map((x) => (
          <button key={x.id} className={`tree-item${section === x.id ? ' on' : ''}`} aria-current={section === x.id} onClick={() => dispatch({ type: 'ui/settingsSection', section: x.id })}>
            <Icon name={x.icon} />
            <span className="tree-name">{x.label}</span>
          </button>
        ))}
      </nav>
      <section className="panel settings-body">
        {section === 'controller' && <ControllerSettings />}
        {section === 'audio' && <AudioCheck />}
        {section === 'preferences' && <Preferences />}
        {section === 'about' && <About />}
      </section>
    </div>
  );
}
