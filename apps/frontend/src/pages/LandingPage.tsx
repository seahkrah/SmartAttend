import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Users, BarChart3, ArrowRight, Github, Shield, Lightbulb } from 'lucide-react';
import { AnimatedIconBackground, BouncingCard, FadeIn, SlideInFromSide } from '../components/Animations';
import { SmartAttendLogo } from '../components/BrandLogo';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: Shield,
      title: 'Secure',
      description: 'Enterprise-grade security with JWT authentication and encrypted data storage',
    },
    {
      icon: Zap,
      title: 'Fast',
      description: 'Lightning-fast API with optimized PostgreSQL queries and connection pooling',
    },
    {
      icon: Users,
      title: 'Scalable',
      description: 'Built to handle thousands of users across school and corporate platforms',
    },
    {
      icon: BarChart3,
      title: 'Analytics',
      description: 'Comprehensive attendance reports and real-time analytics dashboards',
    },
    {
      icon: Lightbulb,
      title: 'Smart',
      description: 'Intelligent insights with face recognition and GPS-based check-ins',
    },
    {
      icon: Github,
      title: 'Open',
      description: 'Built with modern tech stack: React, Express, PostgreSQL, TypeScript',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white overflow-hidden">
      {/* Animated background with floating icons */}
      <AnimatedIconBackground />

      {/* Content */}
      <div className="relative z-10">
        {/* Navigation */}
        <nav className="fixed top-0 left-0 right-0 bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/50 z-40">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SmartAttendLogo size="sm" showText={true} />
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/login')}
                className="text-slate-300 hover:text-white transition-colors"
              >
                Sign In
              </button>
              <button onClick={() => navigate('/register')} className="btn-primary">
                Get Started
              </button>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="min-h-screen pt-32 px-6 flex items-center">
          <div className="max-w-7xl mx-auto w-full grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <SlideInFromSide direction="left">
              <div>
                <div className="inline-flex items-center gap-2 mb-6 px-3 py-1 bg-primary-500/20 border border-primary-500/50 rounded-full">
                  <span className="w-2 h-2 bg-primary-400 rounded-full"></span>
                  <span className="text-sm font-medium text-primary-300">Welcome to SmartAttend</span>
                </div>

                <h1 className="text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                  Attendance <span className="text-gradient">Made Smart</span>
                </h1>

                <p className="text-xl text-slate-300 mb-8 leading-relaxed">
                  A modern, secure, and scalable attendance management platform built for schools and
                  corporations. Real-time tracking, comprehensive analytics, and intelligent insights.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 mb-12">
                  <button
                    onClick={() => navigate('/register')}
                    className="btn-primary justify-center inline-flex items-center gap-2"
                  >
                    Start Free
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button className="btn-outline justify-center inline-flex items-center gap-2">
                    View Demo
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-6">
                  <FadeIn delay={0.2}>
                    <div>
                      <p className="text-3xl font-bold">31+</p>
                      <p className="text-slate-400 text-sm">API Endpoints</p>
                    </div>
                  </FadeIn>
                  <FadeIn delay={0.4}>
                    <div>
                      <p className="text-3xl font-bold">24</p>
                      <p className="text-slate-400 text-sm">Database Tables</p>
                    </div>
                  </FadeIn>
                  <FadeIn delay={0.6}>
                    <div>
                      <p className="text-3xl font-bold">100%</p>
                      <p className="text-slate-400 text-sm">TypeScript</p>
                    </div>
                  </FadeIn>
                </div>
              </div>
            </SlideInFromSide>

            {/* Right Illustration */}
            <SlideInFromSide direction="right" delay={0.2}>
              <div className="hidden lg:flex justify-center">
                <div className="relative w-full h-96">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary-500/20 to-secondary-600/20 rounded-2xl"></div>
                  <div className="absolute inset-4 bg-gradient-to-br from-primary-600/30 to-secondary-700/30 rounded-xl backdrop-blur-xl border border-primary-500/20 flex items-center justify-center">
                    <div className="text-center">
                      <img
                        src="/logos/platform-logo.png"
                        alt="SmartAttend"
                        className="w-24 h-24 mx-auto mb-4 object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <p className="text-2xl font-bold">SmartAttend</p>
                      <p className="text-slate-400 mt-2">Attendance Platform</p>
                    </div>
                  </div>
                </div>
              </div>
            </SlideInFromSide>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <FadeIn>
              <div className="text-center mb-16">
                <h2 className="text-4xl font-bold mb-4">Powerful Features</h2>
                <p className="text-xl text-slate-400">Everything you need to manage attendance efficiently</p>
              </div>
            </FadeIn>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <BouncingCard key={index} delay={index * 0.1}>
                    <FadeIn delay={0.3 + index * 0.1}>
                      <div className="card hover:shadow-glow">
                        <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-secondary-600 rounded-lg flex items-center justify-center mb-4">
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                        <p className="text-slate-400">{feature.description}</p>
                      </div>
                    </FadeIn>
                  </BouncingCard>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 px-6">
          <div className="max-w-3xl mx-auto">
            <FadeIn>
              <div className="card text-center">
                <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
                <p className="text-slate-400 mb-8">
                  Join thousands of organizations using SmartAttend for secure and efficient attendance management.
                </p>
                <button
                  onClick={() => navigate('/register')}
                  className="btn-primary justify-center inline-flex items-center gap-2"
                >
                  Create Your Account
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-700/50 py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="grid md:grid-cols-4 gap-8 mb-8">
              <div>
                <h3 className="font-bold mb-4">SmartAttend</h3>
                <p className="text-slate-400 text-sm">Modern attendance management platform</p>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Product</h4>
                <ul className="space-y-2 text-slate-400 text-sm">
                  <li>
                    <a href="#" className="hover:text-white transition-colors">
                      Features
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-white transition-colors">
                      Pricing
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Company</h4>
                <ul className="space-y-2 text-slate-400 text-sm">
                  <li>
                    <a href="#" className="hover:text-white transition-colors">
                      About
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-white transition-colors">
                      Contact
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Legal</h4>
                <ul className="space-y-2 text-slate-400 text-sm">
                  <li>
                    <a href="#" className="hover:text-white transition-colors">
                      Privacy
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-white transition-colors">
                      Terms
                    </a>
                  </li>
                </ul>
              </div>
            </div>

            <div className="border-t border-slate-700/50 pt-8 text-center text-slate-400 text-sm">
              <p>© 2026 SmartAttend. All rights reserved. Powered by SmartCode</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};
