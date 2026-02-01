import React from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Clock,
  CheckCircle,
  Camera,
  BarChart3,
  Shield,
  Zap,
  Eye,
  MapPin,
} from 'lucide-react';

interface FloatingIconProps {
  Icon: React.ComponentType<{ className?: string }>;
  delay: number;
  duration: number;
  x: number;
  y: number;
}

const FloatingIcon: React.FC<FloatingIconProps> = ({ Icon, delay, duration, x, y }) => {
  return (
    <motion.div
      className="absolute"
      initial={{ x: x, y: y, opacity: 0.6, scale: 0 }}
      animate={{
        x: [x, x + 30, x - 30, x],
        y: [y, y - 40, y + 40, y],
        opacity: [0.4, 0.8, 0.6, 0.4],
        scale: [0, 1, 1, 0],
        rotate: [0, 360, 720, 360],
      }}
      transition={{
        duration: duration,
        delay: delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      whileHover={{ scale: 1.2 }}
    >
      <div className="bg-gradient-to-br from-primary-500/30 to-secondary-600/30 p-4 rounded-full backdrop-blur-sm border border-primary-500/40 hover:border-primary-400/60 transition-colors">
        <Icon className="w-6 h-6 text-primary-300 drop-shadow-lg" />
      </div>
    </motion.div>
  );
};

export const AnimatedIconBackground: React.FC = () => {
  const icons = [
    { Icon: Users, x: 100, y: 50 },
    { Icon: Clock, x: 250, y: 150 },
    { Icon: CheckCircle, x: 400, y: 80 },
    { Icon: Camera, x: 320, y: 280 },
    { Icon: BarChart3, x: 150, y: 350 },
    { Icon: Shield, x: 480, y: 200 },
    { Icon: Zap, x: 50, y: 220 },
    { Icon: Eye, x: 350, y: 380 },
    { Icon: MapPin, x: 200, y: 420 },
  ];

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Animated background circles */}
      <motion.div
        className="absolute top-20 left-10 w-72 h-72 bg-primary-500/20 rounded-full filter blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      <motion.div
        className="absolute bottom-20 right-10 w-72 h-72 bg-secondary-600/20 rounded-full filter blur-3xl"
        animate={{
          scale: [1.2, 1, 1.2],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 8,
          delay: 1,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      <motion.div
        className="absolute top-1/2 left-1/2 w-96 h-96 bg-accent-500/10 rounded-full filter blur-3xl"
        animate={{
          scale: [0.8, 1, 0.8],
          opacity: [0.2, 0.4, 0.2],
        }}
        transition={{
          duration: 10,
          delay: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Floating icons */}
      {icons.map((item, index) => (
        <FloatingIcon
          key={index}
          Icon={item.Icon}
          delay={index * 0.3}
          duration={6 + index * 0.5}
          x={item.x}
          y={item.y}
        />
      ))}

      {/* Orbiting particles */}
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={`particle-${i}`}
          className="absolute w-1 h-1 bg-primary-400 rounded-full"
          animate={{
            x: [0, 200 * Math.cos((i * Math.PI * 2) / 5)],
            y: [0, 200 * Math.sin((i * Math.PI * 2) / 5)],
          }}
          transition={{
            duration: 10 + i,
            repeat: Infinity,
            ease: 'linear',
          }}
          style={{
            left: '50%',
            top: '50%',
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  );
};

// Bouncing cards component
export const BouncingCard: React.FC<{
  children: React.ReactNode;
  delay?: number;
}> = ({ children, delay = 0 }) => {
  return (
    <motion.div
      initial={{ y: 0 }}
      animate={{ y: [0, -10, 0] }}
      transition={{
        duration: 2,
        delay: delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      whileHover={{ y: -15 }}
    >
      {children}
    </motion.div>
  );
};

// Glow pulse component
export const GlowPulse: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <motion.div
      animate={{
        boxShadow: [
          '0 0 20px rgba(93, 127, 255, 0.3)',
          '0 0 40px rgba(93, 127, 255, 0.6)',
          '0 0 20px rgba(93, 127, 255, 0.3)',
        ],
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    >
      {children}
    </motion.div>
  );
};

// Slide in from side component
export const SlideInFromSide: React.FC<{
  children: React.ReactNode;
  direction?: 'left' | 'right';
  delay?: number;
}> = ({ children, direction = 'left', delay = 0 }) => {
  const initialX = direction === 'left' ? -100 : 100;

  return (
    <motion.div
      initial={{ x: initialX, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{
        duration: 0.8,
        delay: delay,
        ease: 'easeOut',
      }}
    >
      {children}
    </motion.div>
  );
};

// Fade in component
export const FadeIn: React.FC<{
  children: React.ReactNode;
  delay?: number;
  duration?: number;
}> = ({ children, delay = 0, duration = 0.6 }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: duration,
        delay: delay,
      }}
    >
      {children}
    </motion.div>
  );
};

// Rotate and scale component
export const RotateScale: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <motion.div
      animate={{
        rotate: [0, 360],
        scale: [1, 1.1, 1],
      }}
      transition={{
        duration: 20,
        repeat: Infinity,
        ease: 'linear',
      }}
    >
      {children}
    </motion.div>
  );
};
