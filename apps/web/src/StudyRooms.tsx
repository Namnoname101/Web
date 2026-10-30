import type { User, Locale } from './types';
import type { Translate } from './components';

interface StudyRoomsPageProps {
  user: User;
  locale: Locale;
  t: Translate;
}

export function StudyRoomsPage({ t }: StudyRoomsPageProps) {
  return (
    <div className="page-stack">
      <div className="panel" style={{ padding: '40px', textAlign: 'center' }}>
        <h2>{t('Phòng học chung đang được chuẩn bị…', 'Study rooms loading…')}</h2>
      </div>
    </div>
  );
}
