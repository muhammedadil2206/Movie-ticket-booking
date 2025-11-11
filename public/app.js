const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/original';
const FALLBACK_POSTER = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=700&q=80';

const API_BASE = window.location.origin.startsWith('file') ? 'http://localhost:5000' : '';

async function handleNotifyRequest(button) {
  const movieId = button.dataset.movieId;
  const movieTitle = button.dataset.movieTitle;
  const release = button.dataset.movieRelease;
  const session = window.heimeshowSession?.get();
  if (!session?.token || !session?.user) {
    const redirectUrl = new URL('auth.html', window.location.origin);
    redirectUrl.searchParams.set('redirect', window.location.pathname + window.location.search);
    window.location.href = redirectUrl.toString();
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Scheduling…';

  try {
    const response = await fetch(`${API_BASE}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        movieId,
        movieTitle,
        releaseDate: release ? formatReleaseDate(release) : 'TBA',
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Unable to schedule notification.');
    }
    button.textContent = 'We’ll Notify You';
  } catch (error) {
    console.error(error);
    button.textContent = 'Notify Me';
    button.disabled = false;
  }
}

const SESSION_PREFIX = 'HEIMESHOW|';

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn('LocalStorage get failed', error);
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn('LocalStorage set failed', error);
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn('LocalStorage remove failed', error);
  }
}

function parseUser(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn('User parse failed', error);
    return null;
  }
}

function getStoredSession() {
  const token = safeStorageGet('heimeshowToken');
  const user = parseUser(safeStorageGet('heimeshowUser'));
  if (token && user) {
    return { token, user };
  }

  if (typeof window.name === 'string' && window.name.startsWith(SESSION_PREFIX)) {
    try {
      const data = JSON.parse(window.name.slice(SESSION_PREFIX.length));
      if (data?.token && data?.user) {
        if (!token) safeStorageSet('heimeshowToken', data.token);
        if (!user) safeStorageSet('heimeshowUser', JSON.stringify(data.user));
        return data;
      }
    } catch (error) {
      console.warn('window.name session parse failed', error);
    }
  }

  return null;
}

function saveSession(token, user) {
  if (!token || !user) return;
  safeStorageSet('heimeshowToken', token);
  safeStorageSet('heimeshowUser', JSON.stringify(user));
  window.name = `${SESSION_PREFIX}${JSON.stringify({ token, user })}`;
}

function clearSession() {
  safeStorageRemove('heimeshowToken');
  safeStorageRemove('heimeshowUser');
  if (typeof window.name === 'string' && window.name.startsWith(SESSION_PREFIX)) {
    window.name = '';
  }
}

window.heimeshowSession = {
  get: getStoredSession,
  save: saveSession,
  clear: clearSession,
};

const marqueeTrack = document.querySelector('.marquee-track');
if (marqueeTrack) {
  marqueeTrack.innerHTML += marqueeTrack.innerHTML;
}

const yearSpan = document.getElementById('year');
if (yearSpan) {
  yearSpan.textContent = new Date().getFullYear();
}

const formatterFull = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const formatterShort = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

function formatReleaseDate(dateString, { variant = 'full' } = {}) {
  if (!dateString) return 'TBD';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return variant === 'short' ? formatterShort.format(date) : formatterFull.format(date);
}

function truncate(text = '', length = 130) {
  if (!text) return 'Details coming soon.';
  return text.length > length ? `${text.slice(0, length).trim()}…` : text;
}

function buildPosterUrl(path) {
  return path ? `${TMDB_IMAGE_BASE}${path}` : FALLBACK_POSTER;
}

function createMovieCard(movie, { buttonLabel, buttonClass, badge, action = 'details' }) {
  const title = movie.title || movie.name || 'Untitled Feature';
  const release = movie.release_date || movie.first_air_date;
  const synopsis = truncate(movie.overview);
  const rating = movie.vote_average ? `${movie.vote_average.toFixed(1)} / 10` : 'Not rated yet';

  return `
    <article class="movie-card">
      <img src="${buildPosterUrl(movie.poster_path)}" alt="${title} poster" />
      <span class="badge">${badge || 'Featured'}</span>
      <h3>${title}</h3>
      <p>${synopsis}</p>
      <button class="${buttonClass}" data-movie-action="${action}" data-movie-id="${movie.id}" data-movie-title="${title}" data-movie-release="${release || ''}" data-movie-rating="${rating}">
        ${buttonLabel}
      </button>
    </article>
  `;
}

async function fetchMovies(endpoint, { language = 'en-US', pages = 1, region = 'US' } = {}) {
  const collected = [];

  for (let page = 1; page <= pages; page += 1) {
    const params = new URLSearchParams();
    if (language) params.set('language', language);
    if (region) params.set('region', region);
    params.set('page', String(page));
    const url = `${API_BASE}/api/tmdb${endpoint}?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TMDB request failed: ${response.status}`);
    }
    const payload = await response.json();
    collected.push(...(payload.results || []));
  }

  return collected;
}

async function fetchMovieDetails(id) {
  const params = new URLSearchParams({
    language: 'en-US',
    append_to_response: 'credits,videos,release_dates,similar,watch/providers',
  });
  const url = `${API_BASE}/api/tmdb/movie/${id}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Movie lookup failed: ${response.status}`);
  }
  return response.json();
}

function renderSection(container, movies, options) {
  if (!container) return;
  if (!movies.length) {
    container.innerHTML = '<p>No titles found right now. Please check back soon.</p>';
    return;
  }

  const cards = movies
    .slice(0, options.limit || 12)
    .map((movie) => {
      const badge = typeof options.badgeBuilder === 'function'
        ? options.badgeBuilder(movie)
        : options.badge || 'Featured';

      return createMovieCard(movie, {
        buttonLabel: options.buttonLabel,
        buttonClass: options.buttonClass,
        badge,
        action: typeof options.actionBuilder === 'function' ? options.actionBuilder(movie) : options.action || 'details',
      });
    })
    .join('');

  container.innerHTML = cards;
}

function hydrateHero(movie, elements) {
  if (!movie || !elements) return;
  const { heroPoster, heroTitle, heroRelease, heroRating, heroBook, heroDetails } = elements;
  if (!heroPoster || !heroTitle || !heroRelease || !heroRating || !heroBook || !heroDetails) return;

  const title = movie.title || movie.name || 'Featured Premiere';
  const release = movie.release_date || movie.first_air_date;
  const rating = movie.vote_average ? `${movie.vote_average.toFixed(1)} / 10 (${movie.vote_count} votes)` : 'Audience rating pending';

  heroPoster.src = buildPosterUrl(movie.backdrop_path || movie.poster_path);
  heroPoster.alt = `${title} key art`;
  heroTitle.textContent = title;
  heroRelease.textContent = formatReleaseDate(release);
  heroRating.textContent = rating;

  heroBook.dataset.movieId = movie.id;
  heroBook.dataset.movieTitle = title;
  heroBook.dataset.movieRelease = release || '';

  heroDetails.dataset.movieId = movie.id;
}

function initResponsiveHeader() {
  const header = document.querySelector('header');
  if (!header || header.querySelector('.nav-toggle')) return;
  const nav = header.querySelector('nav');
  if (!nav) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.setAttribute('aria-label', 'Toggle navigation');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<span></span><span></span><span></span>';
  header.insertBefore(toggle, nav);

  const closeMenu = () => {
    toggle.setAttribute('aria-expanded', 'false');
    header.classList.remove('nav-open');
    document.body.classList.remove('nav-open');
  };

  const openMenu = () => {
    toggle.setAttribute('aria-expanded', 'true');
    header.classList.add('nav-open');
    document.body.classList.add('nav-open');
  };

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  const closeOnEscape = (event) => {
    if (event.key === 'Escape' && header.classList.contains('nav-open')) {
      closeMenu();
    }
  };

  document.addEventListener('keydown', closeOnEscape);

  const interactiveSelectors = ['a', 'button'];
  const closeTargets = [nav, header.querySelector('.header-actions')].filter(Boolean);
  closeTargets.forEach((container) => {
    container.querySelectorAll(interactiveSelectors.join(',')).forEach((element) => {
      element.addEventListener('click', closeMenu);
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeMenu();
    }
  });
}

function hydrateHeaderAuth() {
  const signInLink = document.querySelector('.sign-in-link');
  if (!signInLink) return;

  const session = window.heimeshowSession?.get();
  if (session?.token) {
    signInLink.textContent = 'My Account';
    signInLink.href = 'account.html';
  } else {
    signInLink.textContent = 'Sign In';
    signInLink.href = 'auth.html';
  }
}

function getQueryParam(key) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

function pickWatchProviders(providerData) {
  if (!providerData || typeof providerData !== 'object') return [];
  const region = providerData.AE || providerData.US || providerData.GB || Object.values(providerData)[0];
  if (!region) return [];
  const segments = ['flatrate', 'rent', 'buy'];
  const providers = [];
  segments.forEach((segment) => {
    if (Array.isArray(region[segment])) {
      region[segment].forEach((provider) => {
        providers.push({
          name: provider.provider_name,
          logo: provider.logo_path ? `${TMDB_IMAGE_BASE}${provider.logo_path}` : null,
          type: segment,
        });
      });
    }
  });
  return providers;
}

async function initHomePage() {
  const heroElements = {
    heroPoster: document.querySelector('[data-hero-poster]'),
    heroTitle: document.querySelector('[data-hero-title]'),
    heroRelease: document.querySelector('[data-hero-release]'),
    heroRating: document.querySelector('[data-hero-rating]'),
    heroBook: document.querySelector('[data-hero-book]'),
    heroDetails: document.querySelector('[data-hero-details]'),
  };

  const homeHasHero = Object.values(heroElements).every(Boolean);
  const nowShowingGrid = document.querySelector('[data-now-showing]');
  const comingSoonGrid = document.querySelector('[data-coming-soon]');

  try {
    const [nowPlaying, upcoming] = await Promise.all([
      fetchMovies('/movie/now_playing', { pages: 2 }),
      fetchMovies('/movie/upcoming', { pages: 2 }),
    ]);

    if (homeHasHero && nowPlaying.length) {
      hydrateHero(nowPlaying[0], heroElements);
    }

    if (nowShowingGrid) {
      renderSection(nowShowingGrid, nowPlaying, {
        buttonLabel: 'Book Now',
        buttonClass: 'primary',
        limit: 12,
        badgeBuilder: (movie) => `Now Playing · ${formatReleaseDate(movie.release_date, { variant: 'short' })}`,
        action: 'book',
      });
    }

    if (comingSoonGrid) {
      renderSection(comingSoonGrid, upcoming, {
        buttonLabel: 'Notify Me',
        buttonClass: 'secondary',
        limit: 12,
        badgeBuilder: (movie) => `Opens ${formatReleaseDate(movie.release_date, { variant: 'short' })}`,
        action: 'notify',
      });
    }
  } catch (error) {
    console.error('Unable to load TMDB data', error);
    if (nowShowingGrid) {
      nowShowingGrid.innerHTML = '<p>We are experiencing delays fetching movies. Please refresh.</p>';
    }
    if (comingSoonGrid) {
      comingSoonGrid.innerHTML = '<p>Upcoming premieres are currently unavailable.</p>';
    }
  }
}

async function initNowShowingPage() {
  const grid = document.querySelector('[data-now-showing]');
  if (!grid) return;

  try {
    const nowPlaying = await fetchMovies('/movie/now_playing', { pages: 3 });
    renderSection(grid, nowPlaying, {
      buttonLabel: 'Book Now',
      buttonClass: 'primary',
      limit: 24,
      badgeBuilder: (movie) => `Now Playing · ${formatReleaseDate(movie.release_date, { variant: 'short' })}`,
      action: 'book',
    });
  } catch (error) {
    console.error('Unable to load now playing titles', error);
    grid.innerHTML = '<p>We can’t load screenings right now. Please try again shortly.</p>';
  }
}

async function initComingSoonPage() {
  const grid = document.querySelector('[data-coming-soon]');
  if (!grid) return;

  try {
    const upcoming = await fetchMovies('/movie/upcoming', { pages: 3 });
    renderSection(grid, upcoming, {
      buttonLabel: 'Notify Me',
      buttonClass: 'secondary',
      limit: 24,
      badgeBuilder: (movie) => `Opens ${formatReleaseDate(movie.release_date, { variant: 'short' })}`,
      action: 'notify',
    });
  } catch (error) {
    console.error('Unable to load upcoming titles', error);
    grid.innerHTML = '<p>We can’t load upcoming premieres right now. Please refresh later.</p>';
  }
}

async function initBookingPage() {
  const movieId = getQueryParam('id');
  const providedTitle = decodeURIComponent(getQueryParam('title') || '').trim();
  const posterEl = document.querySelector('[data-booking-poster]');
  const titleEl = document.querySelector('[data-booking-title]');
  const metaEl = document.querySelector('[data-booking-meta]');
  const overviewEl = document.querySelector('[data-booking-overview]');
  const datesEl = document.querySelector('[data-booking-dates]');
  const theatresEl = document.querySelector('[data-booking-theatres]');
  const summarySelectionEl = document.querySelector('[data-summary-selection]');
  const continueBtn = document.querySelector('[data-booking-continue]');
  const statusEl = document.querySelector('[data-booking-status]');

  if (!datesEl || !theatresEl || !continueBtn) return;

  const session = window.heimeshowSession?.get();
  const signedIn = Boolean(session?.token && session?.user);

  const requireSignIn = () => {
    window.location.href = `auth.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  };

  if (!signedIn) {
    if (summarySelectionEl) summarySelectionEl.textContent = 'Sign in to HeimeShow to book tickets.';
    continueBtn.textContent = 'Sign In to Book';
    continueBtn.disabled = false;
    continueBtn.addEventListener('click', requireSignIn);
  }

  if (signedIn) {
    const { user } = session;
    continueBtn.dataset.userName = user.name || '';
    continueBtn.dataset.userEmail = user.email || '';
    continueBtn.dataset.userPhone = user.phone || '';
  }

  const theatres = [
    {
      id: 'marina',
      name: 'HeimeShow Marina Mall',
      location: 'Level 3, Dubai Marina Mall',
      formats: ['IMAX Laser', 'Dolby Atmos', 'Luxe'],
      baseFormat: 'IMAX Laser',
      getShowtimes: (isWeekend) => (isWeekend ? ['10:00', '13:30', '17:15', '20:45', '23:55'] : ['11:15', '14:45', '18:15', '21:45']),
    },
    {
      id: 'citywalk',
      name: 'HeimeShow City Walk',
      location: 'City Walk, Al Wasl',
      formats: ['4DX', 'ScreenX', 'Velvet Lounge'],
      baseFormat: '4DX',
      getShowtimes: (isWeekend) => (isWeekend ? ['09:45', '13:00', '16:20', '19:40', '22:50'] : ['12:00', '15:10', '18:30', '21:30']),
    },
    {
      id: 'palm',
      name: 'HeimeShow Palm Jumeirah',
      location: 'The Pointe, Palm Jumeirah',
      formats: ['VIP Suites', 'Dolby Cinema'],
      baseFormat: 'VIP Suites',
      getShowtimes: (isWeekend) => (isWeekend ? ['11:00', '14:15', '17:30', '20:45'] : ['13:00', '16:15', '19:30', '22:30']),
    },
    {
      id: 'difc',
      name: 'HeimeShow DIFC Executive Lounge',
      location: 'Gate Village 5, DIFC',
      formats: ['Private Boardroom', 'Chef’s Table'],
      baseFormat: 'Private Boardroom',
      getShowtimes: () => ['12:30', '16:00', '19:30', '23:00'],
    },
    {
      id: 'dubaihills',
      name: 'HeimeShow Dubai Hills Estate',
      location: 'Dubai Hills Mall, Al Khail Road',
      formats: ['Dolby Atmos', 'Luxe Pods'],
      baseFormat: 'Dolby Atmos',
      getShowtimes: (isWeekend) => (isWeekend ? ['10:30', '13:45', '17:00', '20:15', '23:15'] : ['11:45', '15:00', '18:30', '21:45']),
    },
    {
      id: 'bluewaters',
      name: 'HeimeShow Bluewaters',
      location: 'Bluewaters Island, Wharf Avenue',
      formats: ['SeaView Lounge', 'ScreenX'],
      baseFormat: 'SeaView Lounge',
      getShowtimes: (isWeekend) => (isWeekend ? ['09:30', '12:45', '16:10', '19:30', '22:40'] : ['11:15', '14:30', '17:45', '21:00']),
    },
    {
      id: 'festivalcity',
      name: 'HeimeShow Festival City',
      location: 'Festival City Mall, Crescent Road',
      formats: ['MX4D', 'Majlis Suites'],
      baseFormat: 'MX4D',
      getShowtimes: (isWeekend) => (isWeekend ? ['10:15', '13:30', '16:45', '20:00', '23:10'] : ['12:00', '15:15', '18:30', '21:45']),
    },
  ];

  const upcomingDays = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      index,
      date,
      label: date.toLocaleDateString('en-GB', { weekday: 'short' }),
      day: date.getDate(),
      month: date.toLocaleDateString('en-GB', { month: 'short' }),
      isWeekend: date.getDay() === 5 || date.getDay() === 6,
      readable: date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
      iso: date.toISOString().split('T')[0],
    };
  });

  let selectedDay = upcomingDays[0];
  let selectedTheatre = null;
  let selectedShowtime = null;
  let selectedFormat = null;

  const buildSummaryText = () => {
    const movieTitle = titleEl?.textContent || providedTitle || 'HeimeShow Feature';
    if (!selectedTheatre || !selectedShowtime) {
      return `${movieTitle} · ${selectedDay.readable} · Select a theatre and showtime`;
    }
    return `${movieTitle} · ${selectedDay.readable} · ${selectedTheatre.name} · ${selectedShowtime} · ${selectedFormat || selectedTheatre.baseFormat}`;
  };

  const updateSummary = () => {
    if (summarySelectionEl) {
      summarySelectionEl.textContent = buildSummaryText();
    }
    continueBtn.disabled = !(selectedTheatre && selectedShowtime);
    continueBtn.textContent = continueBtn.disabled ? 'Continue' : 'Continue';
  };

  const renderDates = () => {
    datesEl.innerHTML = upcomingDays
      .map(
        (day) => `
        <button class="booking-date ${day.index === selectedDay.index ? 'active' : ''}" data-date-index="${day.index}">
          <span>${day.label}</span>
          <strong>${day.day} ${day.month}</strong>
        </button>`
      )
      .join('');
  };

  const renderTheatres = () => {
    theatresEl.innerHTML = '';
    theatres.forEach((theatre) => {
      const showtimes = theatre.getShowtimes(Boolean(selectedDay?.isWeekend));
      const card = document.createElement('article');
      card.className = 'theatre-card';
      card.dataset.theatreId = theatre.id;
      card.innerHTML = `
        <div class="theatre-header">
          <div class="theatre-info">
            <h3>${theatre.name}</h3>
            <span>${theatre.location}</span>
          </div>
          <div class="theatre-formats">
            ${theatre.formats.map((format) => `<span>${format}</span>`).join('')}
          </div>
        </div>
        <div class="showtime-grid">
          ${showtimes
            .map(
              (time) => `
              <button class="showtime-chip" data-showtime="${time}" data-format="${theatre.baseFormat}" data-theatre="${theatre.id}">
                ${time}
              </button>`
            )
            .join('')}
        </div>
      `;
      theatresEl.appendChild(card);
    });
  };

  const attachDateHandlers = () => {
    datesEl.querySelectorAll('.booking-date').forEach((button) => {
      button.addEventListener('click', () => {
        const session = window.heimeshowSession?.get();
        const signedIn = Boolean(session?.token && session?.user);

        const requireSignIn = () => {
          window.location.href = `auth.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        };

        if (!signedIn) {
          requireSignIn();
          return;
        }
        const index = Number.parseInt(button.dataset.dateIndex, 10);
        selectedDay = upcomingDays[index];
        selectedTheatre = null;
        selectedShowtime = null;
        selectedFormat = null;
        renderDates();
        attachDateHandlers();
        renderTheatres();
        attachShowtimeHandlers();
        updateSummary();
      });
    });
  };

  const attachShowtimeHandlers = () => {
    theatresEl.querySelectorAll('.showtime-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const session = window.heimeshowSession?.get();
        const signedIn = Boolean(session?.token && session?.user);

        const requireSignIn = () => {
          window.location.href = `auth.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        };

        if (!signedIn) {
          requireSignIn();
          return;
        }
        theatresEl.querySelectorAll('.showtime-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedTheatre = theatres.find((theatre) => theatre.id === chip.dataset.theatre);
        selectedShowtime = chip.dataset.showtime;
        selectedFormat = chip.dataset.format || selectedTheatre?.baseFormat;
        updateSummary();
      });
    });
  };

  const formatMetaInfo = (movie) => {
    if (!movie) return '';
    const release = movie.release_date ? formatReleaseDate(movie.release_date) : 'TBA';
    const runtime = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : '—';
    const genres = (movie.genres || []).map((g) => g.name).join(', ') || '—';
    return `${release} • ${runtime} • ${genres}`;
  };

  try {
    if (movieId) {
      const movie = await fetchMovieDetails(movieId);
      if (titleEl) titleEl.textContent = movie.title || movie.name || providedTitle || 'HeimeShow Feature';
      if (metaEl) metaEl.textContent = formatMetaInfo(movie);
      if (overviewEl)
        overviewEl.textContent = movie.overview || 'Invite your guests to a bespoke private screening curated by HeimeShow.';
      if (posterEl) {
        posterEl.src = buildPosterUrl(movie.poster_path);
        posterEl.alt = `${movie.title || movie.name || 'HeimeShow'} poster`;
      }
      document.title = `HeimeShow | ${movie.title || movie.name}`;
      continueBtn.dataset.movieId = movie.id;
      continueBtn.dataset.movieTitle = movie.title || movie.name || '';
    } else {
      if (titleEl) titleEl.textContent = providedTitle || 'HeimeShow Feature';
      if (metaEl) metaEl.textContent = 'Dubai · Premium Formats';
    }
  } catch (error) {
    console.error('Unable to load movie for booking', error);
    if (titleEl) titleEl.textContent = providedTitle || 'HeimeShow Feature';
    if (metaEl) metaEl.textContent = 'Dubai · Premium Formats';
  }

  if (!continueBtn.dataset.movieTitle) {
    continueBtn.dataset.movieTitle = providedTitle || titleEl?.textContent || 'HeimeShow Feature';
  }

  renderDates();
  renderTheatres();
  attachDateHandlers();
  attachShowtimeHandlers();
  updateSummary();

  if (!signedIn) {
    return;
  }

  continueBtn.addEventListener('click', () => {
    if (!selectedTheatre || !selectedShowtime || !selectedDay) {
      return;
    }

    const url = new URL('seat-selection.html', window.location.origin);
    url.searchParams.set('id', continueBtn.dataset.movieId || movieId || '');
    url.searchParams.set('title', continueBtn.dataset.movieTitle || providedTitle || titleEl?.textContent || '');
    url.searchParams.set('theatreId', selectedTheatre.id);
    url.searchParams.set('theatre', selectedTheatre.name);
    url.searchParams.set('showtime', selectedShowtime);
    url.searchParams.set('date', selectedDay.iso);
    url.searchParams.set('dateReadable', selectedDay.readable);
    url.searchParams.set('format', selectedFormat || selectedTheatre.baseFormat);
    window.location.href = url.toString();
  });
}

async function initMoviePage() {
  const movieId = getQueryParam('id');
  const hero = document.querySelector('[data-movie-hero]');
  if (!movieId || !hero) {
    if (hero) {
      hero.innerHTML = '<div class="movie-hero-error"><h1>We couldn\'t find that feature.</h1><p>Please return to the programme and choose another title.</p></div>';
    }
    return;
  }

  try {
    hero.classList.add('loading');
    const movie = await fetchMovieDetails(movieId);
    renderMoviePage(movie);
  } catch (error) {
    console.error('Unable to load movie details', error);
    hero.innerHTML = '<div class="movie-hero-error"><h1>We can\'t reach the cinema projection.</h1><p>Refresh the page or return to the programme for more titles.</p></div>';
  } finally {
    hero.classList.remove('loading');
  }
}

async function initSeatSelectionPage() {
  const session = window.heimeshowSession?.get();
  if (!session?.token || !session?.user) {
    const redirect = `${window.location.pathname}${window.location.search}`;
    window.location.href = `auth.html?redirect=${encodeURIComponent(redirect)}`;
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const movieId = params.get('id');
  const movieTitle = decodeURIComponent(params.get('title') || '').trim() || 'HeimeShow Feature';
  const theatreId = params.get('theatreId') || '';
  const theatreName = decodeURIComponent(params.get('theatre') || '').trim() || 'HeimeShow Venue';
  const showtime = params.get('showtime') || 'TBA';
  const dateIso = params.get('date') || '';
  const dateReadable = decodeURIComponent(params.get('dateReadable') || '').trim() || '—';
  const format = decodeURIComponent(params.get('format') || '').trim() || 'Premium Experience';

  const titleEl = document.querySelector('[data-seat-title]');
  const metaEl = document.querySelector('[data-seat-meta]');
  const dateEl = document.querySelector('[data-seat-date]');
  const theatreEl = document.querySelector('[data-seat-theatre]');
  const timeEl = document.querySelector('[data-seat-time]');
  const formatEl = document.querySelector('[data-seat-format]');
  const gridEl = document.querySelector('[data-seat-grid]');
  const totalEl = document.querySelector('[data-seat-total]');
  const statusEl = document.querySelector('[data-seat-status]');
  const confirmBtn = document.querySelector('[data-seat-confirm]');

  if (!gridEl || !totalEl || !statusEl || !confirmBtn) return;

  if (titleEl) titleEl.textContent = movieTitle;
  if (metaEl) metaEl.textContent = `${theatreName} · ${dateReadable}`;
  if (dateEl) dateEl.textContent = dateReadable;
  if (theatreEl) theatreEl.textContent = theatreName;
  if (timeEl) timeEl.textContent = showtime;
  if (formatEl) formatEl.textContent = format;

  const seatMap = [
    { row: 'A', count: 12, premium: false, splitAfter: 6 },
    { row: 'B', count: 12, premium: false, splitAfter: 6 },
    { row: 'C', count: 12, premium: false, splitAfter: 6 },
    { row: 'D', count: 10, premium: true, splitAfter: 5 },
    { row: 'E', count: 10, premium: true, splitAfter: 5 },
    { row: 'F', count: 8, premium: true, splitAfter: 4 },
  ];
  const blockedSeats = new Set(['A1', 'A2', 'F7']);
  const selectedSeats = new Set();
  const pricing = { standard: 95, premium: 145 };

  const renderSeats = () => {
    gridEl.innerHTML = seatMap
      .map((row) => {
        const seats = Array.from({ length: row.count }).map((_, index) => {
          const seatNumber = index + 1;
          const seatId = `${row.row}${seatNumber}`;
          const classes = ['seat-button'];
          if (row.premium) classes.push('premium');
          if (blockedSeats.has(seatId)) classes.push('blocked');
          if (selectedSeats.has(seatId)) classes.push('selected');
          return `<button class="${classes.join(' ')}" data-seat-id="${seatId}" data-seat-premium="${row.premium}">${seatNumber}</button>`;
        });

        if (row.splitAfter && row.splitAfter < seats.length) {
          seats.splice(row.splitAfter, 0, '<span class="seat-aisle"></span>');
        }

        return `
          <div class="seat-row" data-seat-row="${row.row}">
            <span class="seat-row-label">${row.row}</span>
            <div class="seat-row-seats">
              ${seats.join('')}
            </div>
          </div>
        `;
      })
      .join('');

    gridEl.querySelectorAll('.seat-button').forEach((seat) => {
      seat.addEventListener('click', () => {
        const seatId = seat.dataset.seatId;
        if (!seatId || blockedSeats.has(seatId)) return;
        if (selectedSeats.has(seatId)) {
          selectedSeats.delete(seatId);
        } else {
          selectedSeats.add(seatId);
        }
        renderSeats();
        updateSummary();
      });
    });
  };

  const updateSummary = () => {
    let total = 0;
    selectedSeats.forEach((seatId) => {
      const rowLetter = seatId.charAt(0);
      const row = seatMap.find((entry) => entry.row === rowLetter);
      total += row?.premium ? pricing.premium : pricing.standard;
    });

    const seatList = Array.from(selectedSeats);
    totalEl.textContent = seatList.length
      ? `${seatList.length} seat${seatList.length > 1 ? 's' : ''} selected · AED ${total}`
      : '0 seats selected · AED 0';

    statusEl.textContent = seatList.length
      ? `Seats selected: ${seatList.join(', ')}`
      : 'Select seats to proceed.';

    confirmBtn.disabled = seatList.length === 0;
  };

  renderSeats();
  updateSummary();

  confirmBtn.addEventListener('click', () => {
    if (selectedSeats.size === 0) return;

    const total = Array.from(selectedSeats).reduce((acc, seatId) => {
      const rowLetter = seatId.charAt(0);
      const row = seatMap.find((entry) => entry.row === rowLetter);
      return acc + (row?.premium ? pricing.premium : pricing.standard);
    }, 0);

    const url = new URL('payment.html', window.location.origin);
    url.searchParams.set('id', movieId || '');
    url.searchParams.set('title', movieTitle);
    url.searchParams.set('theatreId', theatreId);
    url.searchParams.set('theatre', theatreName);
    url.searchParams.set('showtime', showtime);
    url.searchParams.set('date', dateIso);
    url.searchParams.set('dateReadable', dateReadable);
    url.searchParams.set('format', format);
    url.searchParams.set('seats', Array.from(selectedSeats).join(','));
    url.searchParams.set('total', String(total));

    window.location.href = url.toString();
  });
}

async function initPaymentPage() {
  const session = window.heimeshowSession?.get();
  if (!session?.token || !session?.user) {
    const redirect = `${window.location.pathname}${window.location.search}`;
    window.location.href = `auth.html?redirect=${encodeURIComponent(redirect)}`;
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const movieId = params.get('id');
  const movieTitle = decodeURIComponent(params.get('title') || '').trim() || 'HeimeShow Feature';
  const theatreId = params.get('theatreId') || '';
  const theatreName = decodeURIComponent(params.get('theatre') || '').trim() || 'HeimeShow Theatre';
  const showtime = params.get('showtime') || 'TBA';
  const dateIso = params.get('date') || '';
  const dateReadable = decodeURIComponent(params.get('dateReadable') || '').trim() || '—';
  const format = decodeURIComponent(params.get('format') || '').trim() || 'Premium Experience';
  const seats = decodeURIComponent(params.get('seats') || '').split(',').filter(Boolean);
  const total = Number.parseInt(params.get('total') || '0', 10) || 0;

  const movieEl = document.querySelector('[data-payment-movie]');
  const theatreEl = document.querySelector('[data-payment-theatre]');
  const dateEl = document.querySelector('[data-payment-date]');
  const timeEl = document.querySelector('[data-payment-time]');
  const formatEl = document.querySelector('[data-payment-format]');
  const seatsEl = document.querySelector('[data-payment-seats]');
  const totalEl = document.querySelector('[data-payment-total]');
  const form = document.querySelector('[data-payment-form]');
  const statusEl = document.querySelector('[data-payment-status]');
  const cardFields = document.querySelector('[data-card-fields]');

  if (movieEl) movieEl.textContent = movieTitle;
  if (theatreEl) theatreEl.textContent = theatreName;
  if (dateEl) dateEl.textContent = dateReadable || dateIso;
  if (timeEl) timeEl.textContent = showtime;
  if (formatEl) formatEl.textContent = format;
  if (seatsEl) seatsEl.textContent = seats.length ? seats.join(', ') : '—';
  if (totalEl) totalEl.textContent = `AED ${total}`;

  if (!form) return;

  const cardMethods = new Set(['Visa', 'Mastercard']);
  const cardInputs = cardFields ? Array.from(cardFields.querySelectorAll('input')) : [];

  form.addEventListener('change', (event) => {
    if (event.target.name === 'method' && cardFields) {
      const isCard = cardMethods.has(event.target.value);
      cardFields.hidden = !isCard;
      cardInputs.forEach((input) => {
        if (isCard) {
          input.setAttribute('required', 'required');
          input.disabled = false;
        } else {
          input.removeAttribute('required');
          input.disabled = true;
          input.value = '';
        }
      });
    }
  });

  if (cardFields) {
    cardFields.hidden = true;
    cardInputs.forEach((input) => {
      input.removeAttribute('required');
      input.disabled = true;
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const method = formData.get('method');
    if (!method) {
      if (statusEl) {
        statusEl.textContent = 'Select a payment method to continue.';
        statusEl.classList.add('error');
      }
      return;
    }

    if (cardFields && !cardFields.hidden) {
      const requiredFields = ['cardName', 'cardNumber', 'expiry', 'cvv'];
      const missing = requiredFields.some((field) => !formData.get(field));
      if (missing) {
        if (statusEl) {
          statusEl.textContent = 'Please complete your card details.';
          statusEl.classList.add('error');
        }
        return;
      }
    }

    if (statusEl) {
      statusEl.textContent = 'Processing your reservation…';
      statusEl.classList.remove('error', 'success');
    }

    const payload = {
      enquiryType: 'Ticket Payment',
      name: session.user.name || 'HeimeShow Guest',
      email: session.user.email,
      phone: session.user.phone || '',
      preferredDate: dateIso,
      groupSize: `${seats.length} seats`,
      message: `Payment intent for ${movieTitle}\nTheatre: ${theatreName}\nDate: ${dateReadable}\nShowtime: ${showtime}\nSeats: ${seats.join(', ') || 'N/A'}\nFormat: ${format}\nMethod: ${method}\nAmount: AED ${total}`,
      metadata: {
        movieId: movieId || '',
        movieTitle,
        theatreId,
        theatreName,
        showtime,
        dateReadable,
        dateIso,
        format,
        seats,
        total,
        method,
      },
    };

    try {
      const response = await fetch(`${API_BASE}/api/enquiry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'Unable to confirm payment.');
      }
      if (statusEl) {
        statusEl.textContent = 'Payment noted! Expect a concierge call within minutes.';
        statusEl.classList.add('success');
      }
      form.reset();
    } catch (error) {
      console.error(error);
      if (statusEl) {
        statusEl.textContent = error.message || 'We could not process your payment. Please try again.';
        statusEl.classList.add('error');
      }
    }
  });
}

function initPage() {
  const page = document.body.dataset.page || 'home';

  switch (page) {
    case 'home':
      initHomePage();
      break;
    case 'now-showing':
      initNowShowingPage();
      break;
    case 'coming-soon':
      initComingSoonPage();
      break;
    case 'movie':
      initMoviePage();
      break;
    case 'booking':
      initBookingPage();
      break;
    case 'seat':
      initSeatSelectionPage();
      break;
    case 'payment':
      initPaymentPage();
      break;
    default:
      break;
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-movie-action]');
  if (!button) return;
  const action = button.dataset.movieAction;
  const movieId = button.dataset.movieId;

  switch (action) {
    case 'book':
      if (!movieId) return;
      window.location.href = `movie.html?id=${movieId}`;
      break;
    case 'notify':
      handleNotifyRequest(button);
      break;
    default:
      if (!movieId) return;
      window.location.href = `movie.html?id=${movieId}`;
      break;
  }
});

initResponsiveHeader();

hydrateHeaderAuth();

initPage();

function renderMoviePage(movie) {
  const posterEl = document.querySelector('[data-movie-poster]');
  const titleEl = document.querySelector('[data-movie-title]');
  const overviewEl = document.querySelector('[data-movie-overview]');
  const metaEl = document.querySelector('[data-movie-meta]');
  const statusEl = document.querySelector('[data-movie-status]');
  const backdropEl = document.querySelector('[data-movie-backdrop]');
  const highlightsEl = document.querySelector('[data-movie-highlights]');
  const castEl = document.querySelector('[data-movie-cast]');
  const providersEl = document.querySelector('[data-movie-providers]');
  const similarSection = document.querySelector('[data-movie-similar-section]');
  const similarGrid = document.querySelector('[data-movie-similar]');
  const trailersSection = document.querySelector('[data-movie-trailers-section]');
  const trailersGrid = document.querySelector('[data-movie-trailers]');
  const bookBtn = document.querySelector('[data-book-movie]');

  if (!movie || !titleEl) return;

  const releaseDate = movie.release_date ? formatReleaseDate(movie.release_date) : 'TBA';
  const runtime = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : '—';
  const genres = (movie.genres || []).map((g) => g.name).join(', ') || '—';
  const rating = movie.vote_average ? `${movie.vote_average.toFixed(1)} / 10` : 'Unrated';

  titleEl.textContent = movie.title || movie.name || 'Untitled Feature';
  overviewEl.textContent = movie.overview || 'Details are on the way for this feature.';
  metaEl.textContent = `${releaseDate} • ${runtime} • ${genres}`;
  statusEl.textContent = movie.status || 'Feature';

  if (posterEl) {
    posterEl.src = buildPosterUrl(movie.poster_path);
    posterEl.alt = `${titleEl.textContent} poster`;
  }

  if (backdropEl) {
    const backdrop = movie.backdrop_path ? `${TMDB_BACKDROP_BASE}${movie.backdrop_path}` : buildPosterUrl(movie.poster_path);
    backdropEl.style.backgroundImage = `url('${backdrop}')`;
  }

  if (highlightsEl) {
    highlightsEl.innerHTML = '';
    const items = [
      { label: 'Release', value: releaseDate },
      { label: 'Runtime', value: runtime },
      { label: 'Genres', value: genres },
      { label: 'Rating', value: rating },
      { label: 'Original Title', value: movie.original_title || '—' },
      {
        label: 'Spoken Languages',
        value: (movie.spoken_languages || []).map((lang) => lang.english_name || lang.name).join(', ') || '—',
      },
      { label: 'Budget', value: movie.budget ? `$${movie.budget.toLocaleString()}` : '—' },
      { label: 'Revenue', value: movie.revenue ? `$${movie.revenue.toLocaleString()}` : '—' },
    ];
    items.forEach((item) => {
      const dt = document.createElement('dt');
      dt.textContent = item.label;
      const dd = document.createElement('dd');
      dd.textContent = item.value;
      highlightsEl.appendChild(dt);
      highlightsEl.appendChild(dd);
    });
  }

  if (castEl) {
    castEl.innerHTML = '';
    const cast = (movie.credits?.cast || []).slice(0, 8);
    if (cast.length) {
      cast.forEach((person) => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${person.name}</strong><span>${person.character || '—'}</span>`;
        castEl.appendChild(li);
      });
    } else {
      castEl.innerHTML = '<li>No cast information available.</li>';
    }
  }

  if (providersEl) {
    providersEl.innerHTML = '';
    const providers = pickWatchProviders(movie['watch/providers']?.results || {});
    if (providers.length) {
      providers.forEach((provider) => {
        const div = document.createElement('div');
        div.className = 'provider-card';
        div.innerHTML = `
          ${provider.logo ? `<img src="${provider.logo}" alt="${provider.name}" />` : ''}
          <span>${provider.name}</span>
          <em>${provider.type}</em>
        `;
        providersEl.appendChild(div);
      });
    } else {
      providersEl.innerHTML = '<p>Streaming providers are not available in your region yet.</p>';
    }
  }

  if (similarSection && similarGrid) {
    const similar = Array.isArray(movie.similar?.results) ? movie.similar.results.slice(0, 8) : [];
    if (similar.length) {
      similarSection.hidden = false;
      const cards = similar
        .map((similarMovie) => {
          const title = similarMovie.title || similarMovie.name || 'Untitled';
          const poster = buildPosterUrl(similarMovie.poster_path);
          const releaseLabel = formatReleaseDate(similarMovie.release_date || similarMovie.first_air_date, { variant: 'short' });
          return `
            <article class="movie-card compact" data-movie-id="${similarMovie.id}">
              <img src="${poster}" alt="${title} poster" />
              <span class="badge">${releaseLabel}</span>
              <h3>${title}</h3>
            </article>
          `;
        })
        .join('');
      similarGrid.innerHTML = cards;
    } else {
      similarSection.hidden = true;
      similarGrid.innerHTML = '';
    }
  }

  if (trailersSection && trailersGrid) {
    const trailers = (movie.videos?.results || []).filter(
      (video) => video.site === 'YouTube' && ['Trailer', 'Teaser'].includes(video.type)
    );
    if (trailers.length) {
      trailersSection.hidden = false;
      trailersGrid.innerHTML = trailers
        .slice(0, 4)
        .map(
          (video) => `
          <iframe
            src="https://www.youtube.com/embed/${video.key}?rel=0"
            title="${video.name}"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>
        `
        )
        .join('');
    } else {
      trailersSection.hidden = true;
      trailersGrid.innerHTML = '';
    }
  }

  if (bookBtn) {
    bookBtn.addEventListener('click', () => {
      const session = window.heimeshowSession?.get();
      if (!session?.token || !session?.user) {
        const redirectUrl = new URL('auth.html', window.location.origin);
        redirectUrl.searchParams.set('redirect', window.location.pathname + window.location.search);
        window.location.href = redirectUrl.toString();
        return;
      }

      const url = new URL('booking.html', window.location.origin);
      url.searchParams.set('id', movie.id);
      if (movie.title || movie.name) {
        url.searchParams.set('title', movie.title || movie.name);
      }
      window.location.href = url.toString();
    });
  }
}