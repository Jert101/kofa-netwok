"use client";

import { useEffect, useRef } from "react";

/**
 * Fade a section up as it comes into view.
 *
 * ## Why the class is applied by an effect and not rendered
 *
 * The alternative is a `.reveal` class in the markup with the observer adding `.is-in`. That version
 * renders every section at `opacity: 0` on the server and waits for JavaScript. With the script slow,
 * blocked, or failed, the parish's front door is a page of invisible text -- and the failure is invisible
 * too, because a page that is merely blank looks like a page still loading.
 *
 * So the hidden state is added *by this component*, after mount. Server-rendered HTML is the finished
 * page; only once the observer is attached does anything become eligible to animate. A browser without
 * `IntersectionObserver`, or a person who asked for reduced motion, gets the finished page and nothing
 * happens to it.
 *
 * ## Why each element is unobserved after it arrives
 *
 * Otherwise every scroll past a revealed section re-runs the observer's callback for it, forever. Not
 * visibly wrong, but it is work nobody asked for on a page that is mostly static.
 */
export function Reveal({
  children,
  as: Tag = "div",
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  as?: "div" | "section" | "li" | "ul" | "header";
  className?: string;
  /** A short stagger within one grid, in milliseconds. */
  delay?: number;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    // Anything that cannot be observed -- or does not want to be animated -- gets the page as-is.
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.classList.add("reveal");
    if (delay > 0) {
      // Set as a style rather than as a class so the delay is a number this component holds, and not a
      // pile of `delay-[80ms]` utilities repeated down the page.
      el.style.transitionDelay = `${delay}ms`;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      // A fifth in view before it moves: a section that has only just touched the bottom of a phone
      // should not have started animating before the reader has decided to look at it.
      { threshold: 0.12 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <Tag
      // The ref is typed for any of these elements; the union keeps `useRef` from having to be generic.
      ref={ref as React.Ref<never>}
      className={className}
    >
      {children}
    </Tag>
  );
}