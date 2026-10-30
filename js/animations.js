/**
 * animations.js — GSAP Animation Module
 *
 * Orchestrates all page animations:
 * - Hero section entrance animation
 * - Scroll-triggered reveals for sections and cards
 * - Floating oil drop animations
 * - Hover tilt effects for product cards
 *
 * Respects prefers-reduced-motion: if the user has requested
 * reduced motion, all GSAP animations are skipped and elements
 * are shown immediately.
 *
 * GSAP + ScrollTrigger are loaded via CDN in index.html.
 */


// ── Reduced Motion Check ──
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/**
 * Initialize all page animations.
 * Should be called after the storefront DOM is rendered.
 */
export function initAnimations() {
  if (prefersReducedMotion) {
    showAllRevealElements();
    console.info('[Animations] Reduced motion preferred — animations disabled.');
    return;
  }

  if (typeof gsap === 'undefined') {
    console.warn('[Animations] GSAP not loaded — showing elements without animation.');
    showAllRevealElements();
    return;
  }

  // Register ScrollTrigger if available
  if (typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
  }

  animateHero();
  initScrollReveal();
  initFloatingDrops();
  initProductCardHover();
}


/**
 * Fallback: make all reveal elements visible immediately.
 */
function showAllRevealElements() {
  document.querySelectorAll('.reveal, .reveal--left, .reveal--right, .reveal--scale').forEach(el => {
    el.classList.add('reveal--visible');
  });
}


/**
 * Hero section entrance animation.
 */
export function animateHero() {
  if (typeof gsap === 'undefined') return;

  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  // Badge
  tl.from('.hero__badge', {
    opacity: 0,
    y: 20,
    duration: 0.6
  });

  // Title
  tl.from('.hero__title', {
    opacity: 0,
    y: 30,
    duration: 0.8
  }, '-=0.3');

  // Description
  tl.from('.hero__description', {
    opacity: 0,
    y: 20,
    duration: 0.6
  }, '-=0.4');

  // Action buttons
  tl.from('.hero__actions .btn', {
    opacity: 0,
    y: 15,
    stagger: 0.15,
    duration: 0.5
  }, '-=0.3');

  // Stats
  tl.from('.hero__stat', {
    opacity: 0,
    y: 20,
    stagger: 0.1,
    duration: 0.5
  }, '-=0.2');

  // Oil display (right side)
  tl.from('.hero__oil-display', {
    opacity: 0,
    scale: 0.85,
    duration: 1,
    ease: 'power2.out'
  }, 0.3);

  // Oil ring expansion
  tl.from('.hero__oil-ring', {
    scale: 0.5,
    opacity: 0,
    stagger: 0.15,
    duration: 0.8,
    ease: 'power2.out'
  }, 0.5);
}


/**
 * Scroll-triggered reveal animations.
 */
export function initScrollReveal() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    showAllRevealElements();
    return;
  }

  // Standard reveals (fade up)
  gsap.utils.toArray('.reveal').forEach(el => {
    gsap.from(el, {
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        once: true
      },
      opacity: 0,
      y: 30,
      duration: 0.7,
      ease: 'power2.out',
      onComplete: () => el.classList.add('reveal--visible')
    });
  });

  // Reveal from left
  gsap.utils.toArray('.reveal--left').forEach(el => {
    gsap.from(el, {
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        once: true
      },
      opacity: 0,
      x: -40,
      duration: 0.7,
      ease: 'power2.out',
      onComplete: () => el.classList.add('reveal--visible')
    });
  });

  // Reveal from right
  gsap.utils.toArray('.reveal--right').forEach(el => {
    gsap.from(el, {
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        once: true
      },
      opacity: 0,
      x: 40,
      duration: 0.7,
      ease: 'power2.out',
      onComplete: () => el.classList.add('reveal--visible')
    });
  });

  // Scale reveals (categories)
  gsap.utils.toArray('.reveal--scale').forEach((el, i) => {
    gsap.from(el, {
      scrollTrigger: {
        trigger: el,
        start: 'top 90%',
        once: true
      },
      opacity: 0,
      scale: 0.88,
      duration: 0.5,
      delay: i * 0.08,
      ease: 'back.out(1.4)',
      onComplete: () => el.classList.add('reveal--visible')
    });
  });

  // Section headers
  gsap.utils.toArray('.section__header').forEach(header => {
    gsap.from(header, {
      scrollTrigger: {
        trigger: header,
        start: 'top 85%',
        once: true
      },
      opacity: 0,
      y: 25,
      duration: 0.7,
      ease: 'power2.out'
    });
  });

  // Stagger product cards within the grid
  const productsGrid = document.querySelector('.products-grid');
  if (productsGrid) {
    const cards = productsGrid.querySelectorAll('.product-card');
    gsap.from(cards, {
      scrollTrigger: {
        trigger: productsGrid,
        start: 'top 80%',
        once: true
      },
      opacity: 0,
      y: 40,
      stagger: 0.12,
      duration: 0.6,
      ease: 'power2.out',
      onComplete: () => cards.forEach(c => c.classList.add('reveal--visible'))
    });
  }
}


/**
 * Floating oil drop animations (continuous, subtle).
 */
function initFloatingDrops() {
  if (typeof gsap === 'undefined') return;

  document.querySelectorAll('.hero__floating-drop').forEach((drop, i) => {
    gsap.to(drop, {
      y: `random(-15, 15)`,
      x: `random(-8, 8)`,
      rotation: `random(-10, 10)`,
      duration: `random(3, 5)`,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: i * 0.4
    });
  });
}


/**
 * Subtle tilt / lift effect on product card hover.
 * Uses mousemove for a perspective-based 3D tilt.
 */
function initProductCardHover() {
  if (typeof gsap === 'undefined') return;

  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      gsap.to(card, {
        scale: 1.02,
        boxShadow: '0 20px 40px rgba(0,0,0,0.12)',
        duration: 0.3,
        ease: 'power2.out'
      });
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        scale: 1,
        boxShadow: '0 0 0 rgba(0,0,0,0)',
        duration: 0.3,
        ease: 'power2.out'
      });
    });

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const rotateX = ((e.clientY - centerY) / rect.height) * -4;
      const rotateY = ((e.clientX - centerX) / rect.width) * 4;

      gsap.to(card, {
        rotateX: rotateX,
        rotateY: rotateY,
        transformPerspective: 800,
        duration: 0.3,
        ease: 'power2.out'
      });
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        duration: 0.4,
        ease: 'power2.out'
      });
    });
  });
}
